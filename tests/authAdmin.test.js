import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";

// The real admin router pulls in the controller and its dependencies.
// Mock the ones that would touch the network or the database.
vi.mock("../models/companionModel.js", () => ({ default: vi.fn() }));
vi.mock("cloudinary", () => ({ v2: { uploader: { upload: vi.fn() } } }));

import authAdmin from "../middlewares/authAdmin.js";
import adminRouter from "../routes/adminRoute.js";

const ADMIN_EMAIL = "admin@joyful.com";
const ADMIN_PASSWORD = "Adm1n$ecret";
const JWT_SECRET = "test-jwt-secret";

// A token exactly like the one loginAdmin issues for valid credentials
const validToken = () => jwt.sign(ADMIN_EMAIL + ADMIN_PASSWORD, JWT_SECRET);

const NOT_AUTHORIZED = {
  success: false,
  message: "Not Authorized Login again",
};

const mockRes = () => ({ json: vi.fn() });

// addCompanion's response when a request reaches it with no fields and no image
const ALL_FIELDS_MISSING =
  "Missing details: name, email, password, location, experience, about, fees, address, image";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
  vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
  vi.stubEnv("JWT_SECRET", JWT_SECRET);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Calling the middleware directly. Node stores incoming header names in
// lowercase, so a client's `adminToken` header arrives as `admintoken`.
// ---------------------------------------------------------------------------
describe("authAdmin (direct)", () => {
  const run = async (headers) => {
    const req = { headers };
    const res = mockRes();
    const next = vi.fn();
    await authAdmin(req, res, next);
    return { res, next };
  };

  it("calls next() for a valid admin token", async () => {
    const { res, next } = await run({ admintoken: validToken() });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("rejects a request without a token", async () => {
    const { res, next } = await run({});

    expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an empty token", async () => {
    const { res, next } = await run({ admintoken: "" });

    expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = jwt.sign(ADMIN_EMAIL + ADMIN_PASSWORD, "attacker-secret");

    const { res, next } = await run({ admintoken: forged });

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "invalid signature",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed token for different credentials", async () => {
    const other = jwt.sign("someone@else.com" + ADMIN_PASSWORD, JWT_SECRET);

    const { res, next } = await run({ admintoken: other });

    expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a valid token after the admin password is changed", async () => {
    const token = validToken();
    vi.stubEnv("ADMIN_PASSWORD", "N3w$password");

    const { res, next } = await run({ admintoken: token });

    expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed token", async () => {
    const { res, next } = await run({ admintoken: "not-a-jwt" });

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "jwt malformed",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request when JWT_SECRET is not set", async () => {
    const token = validToken();
    vi.stubEnv("JWT_SECRET", undefined);

    const { res, next } = await run({ admintoken: token });

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: expect.any(String),
    });
    expect(next).not.toHaveBeenCalled();
  });

  describe("when admin credentials are not configured", () => {
    // JWT_SECRET stays set in every case. Each token is signed with the real
    // secret and built the same way the middleware builds its expected value
    // (ADMIN_EMAIL + ADMIN_PASSWORD). With a missing or empty value, that
    // would match tokens issued while the server was misconfigured.
    it.each([
      ["ADMIN_EMAIL and ADMIN_PASSWORD are both missing", undefined, undefined],
      ["ADMIN_EMAIL is missing", undefined, ADMIN_PASSWORD],
      ["ADMIN_PASSWORD is missing", ADMIN_EMAIL, undefined],
      ["ADMIN_EMAIL and ADMIN_PASSWORD are both empty", "", ""],
      ["ADMIN_EMAIL is empty", "", ADMIN_PASSWORD],
      ["ADMIN_PASSWORD is empty", ADMIN_EMAIL, ""],
    ])(
      "rejects a matching token when %s",
      async (_case, envEmail, envPassword) => {
        vi.stubEnv("ADMIN_EMAIL", envEmail);
        vi.stubEnv("ADMIN_PASSWORD", envPassword);
        const token = jwt.sign(String(envEmail) + String(envPassword), JWT_SECRET);

        const { res, next } = await run({ admintoken: token });

        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
        expect(next).not.toHaveBeenCalled();
      },
    );

    it("rejects a token issued while credentials were configured", async () => {
      const token = validToken();
      vi.stubEnv("ADMIN_PASSWORD", undefined);

      const { res, next } = await run({ admintoken: token });

      expect(res.json).toHaveBeenCalledWith(NOT_AUTHORIZED);
      expect(next).not.toHaveBeenCalled();
    });

    it("logs the misconfiguration on the server without revealing it to the client", async () => {
      vi.stubEnv("ADMIN_EMAIL", undefined);

      const { res } = await run({ admintoken: validToken() });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("ADMIN_EMAIL"),
      );
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("ADMIN_");
    });
  });
});

// ---------------------------------------------------------------------------
// Over real HTTP, so Node parses the headers exactly as in production.
// ---------------------------------------------------------------------------
describe("authAdmin (over HTTP)", () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.get("/protected", authAdmin, (req, res) =>
      res.json({ success: true, message: "reached handler" }),
    );
    // The real admin routes, mounted as in server.js
    app.use("/api/admin", adminRouter);

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it.each(["adminToken", "admintoken", "ADMINTOKEN", "AdminToken"])(
    "accepts the token sent in a '%s' header",
    async (headerName) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { [headerName]: validToken() },
      });

      expect(await response.json()).toEqual({
        success: true,
        message: "reached handler",
      });
    },
  );

  it("rejects a request without the header", async () => {
    const response = await fetch(`${baseUrl}/protected`);

    expect(await response.json()).toEqual(NOT_AUTHORIZED);
  });

  it("rejects a token sent under a different header name", async () => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { token: validToken() },
    });

    expect(await response.json()).toEqual(NOT_AUTHORIZED);
  });

  it("lets an authenticated request reach the add-companion controller", async () => {
    // An empty body passes auth and is then rejected by addCompanion itself,
    // which proves the request got past the middleware.
    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: { adminToken: validToken(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(await response.json()).toEqual({
      success: false,
      message: ALL_FIELDS_MISSING,
    });
  });

  it("accepts the token returned by the login endpoint", async () => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const { success, token } = await login.json();
    expect(success).toBe(true);

    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: { adminToken: token, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(await response.json()).toEqual({
      success: false,
      message: ALL_FIELDS_MISSING,
    });
  });

  it("reports every field missing for an authenticated request with no body", async () => {
    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: { adminToken: validToken() },
    });

    expect(await response.json()).toEqual({
      success: false,
      message: ALL_FIELDS_MISSING,
    });
  });

  it("reports only the missing fields for a multipart request", async () => {
    const form = new FormData();
    form.append("name", "Jane Doe");
    form.append("email", "jane@example.com");
    form.append("password", "Passw0rd$");
    form.append("location", "Nairobi");
    form.append("about", "Friendly and patient companion.");
    form.append("address", JSON.stringify({ line1: "123 Main St" }));

    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: { adminToken: validToken() },
      body: form,
    });

    expect(await response.json()).toEqual({
      success: false,
      message: "Missing details: experience, fees, image",
    });
  });

  it("blocks an unauthenticated request to add-companion", async () => {
    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(await response.json()).toEqual(NOT_AUTHORIZED);
  });

  it("blocks add-companion when admin credentials are not configured", async () => {
    vi.stubEnv("ADMIN_PASSWORD", undefined);
    const misconfiguredToken = jwt.sign(ADMIN_EMAIL + "undefined", JWT_SECRET);

    const response = await fetch(`${baseUrl}/api/admin/add-companion`, {
      method: "POST",
      headers: {
        adminToken: misconfiguredToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(await response.json()).toEqual(NOT_AUTHORIZED);
  });
});
