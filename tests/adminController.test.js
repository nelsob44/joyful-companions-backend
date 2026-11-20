import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for every external dependency of adminController.js except `validator`,
// which is a pure library and is used for real.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  genSalt: vi.fn(),
  hash: vi.fn(),
  upload: vi.fn(),
  destroy: vi.fn(),
  sign: vi.fn(),
  save: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: { genSalt: mocks.genSalt, hash: mocks.hash },
}));

vi.mock("cloudinary", () => ({
  v2: { uploader: { upload: mocks.upload, destroy: mocks.destroy } },
}));

vi.mock("jsonwebtoken", () => ({
  default: { sign: mocks.sign },
}));

// companionModel is used as a constructor (`new companionModel(data).save()`)
// and for the duplicate-email lookup (`companionModel.findOne(...)`)
vi.mock("../models/companionModel.js", () => {
  const model = vi.fn(function (data) {
    Object.assign(this, data);
    this.save = mocks.save;
  });
  model.findOne = mocks.findOne;
  return { default: model };
});

import companionModel from "../models/companionModel.js";
import { addCompanion, loginAdmin } from "../controllers/adminController.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockRes = () => ({ json: vi.fn() });

const validBody = () => ({
  name: "Jane Doe",
  email: "jane@example.com",
  password: "Passw0rd$",
  location: "Nairobi",
  experience: "3 Years",
  about: "Friendly and patient companion.",
  fees: "50",
  address: JSON.stringify({ line1: "123 Main St", line2: "Apt 4" }),
});

const validFile = () => ({
  path: "/tmp/uploads/jane.png",
  originalname: "jane.png",
});

const makeReq = (bodyOverrides = {}, file = validFile()) => ({
  body: { ...validBody(), ...bodyOverrides },
  file,
});

const IMAGE_URL = "https://res.cloudinary.com/demo/image/upload/jane.png";
const IMAGE_PUBLIC_ID = "jane";

beforeEach(() => {
  vi.clearAllMocks();
  // The controller logs request details and errors; keep test output clean.
  vi.spyOn(console, "log").mockImplementation(() => {});

  mocks.genSalt.mockResolvedValue("salt");
  mocks.hash.mockResolvedValue("hashed-password");
  mocks.upload.mockResolvedValue({
    secure_url: IMAGE_URL,
    public_id: IMAGE_PUBLIC_ID,
  });
  mocks.destroy.mockResolvedValue({ result: "ok" });
  mocks.findOne.mockResolvedValue(null);
  mocks.save.mockResolvedValue(undefined);
  mocks.sign.mockReturnValue("signed-token");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// addCompanion
// ---------------------------------------------------------------------------
describe("addCompanion", () => {
  // An invalid request must not query the database, hash, upload or save
  const expectNoSideEffects = () => {
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(companionModel).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  };

  describe("success", () => {
    it("hashes the password, uploads the image, saves the companion and responds with success", async () => {
      const req = makeReq();
      const res = mockRes();
      const before = Date.now();

      await addCompanion(req, res);

      expect(mocks.findOne).toHaveBeenCalledWith({ email: "jane@example.com" });
      expect(mocks.genSalt).toHaveBeenCalledWith(10);
      expect(mocks.hash).toHaveBeenCalledWith("Passw0rd$", "salt");
      expect(mocks.upload).toHaveBeenCalledWith("/tmp/uploads/jane.png", {
        resource_type: "image",
      });

      expect(companionModel).toHaveBeenCalledTimes(1);
      const saved = companionModel.mock.calls[0][0];
      expect(saved).toEqual({
        name: "Jane Doe",
        email: "jane@example.com",
        image: IMAGE_URL,
        password: "hashed-password",
        location: "Nairobi",
        experience: "3 Years",
        about: "Friendly and patient companion.",
        fees: "50",
        address: { line1: "123 Main St", line2: "Apt 4" },
        date: expect.any(Number),
      });
      expect(saved.date).toBeGreaterThanOrEqual(before);
      expect(saved.date).toBeLessThanOrEqual(Date.now());

      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.destroy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Companion added",
      });
    });

    it("never stores the plain-text password", async () => {
      await addCompanion(makeReq(), mockRes());

      const saved = companionModel.mock.calls[0][0];
      expect(saved.password).toBe("hashed-password");
      expect(saved.password).not.toBe("Passw0rd$");
    });
  });

  describe("missing details", () => {
    // Every required field, in the order they are listed in the error message.
    // The image is sent as the multipart field "image" (see adminRoute.js).
    const REQUIRED_FIELDS = [
      "name",
      "email",
      "password",
      "location",
      "experience",
      "about",
      "fees",
      "address",
      "image",
    ];

    const expectMissing = (res, fields) => {
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: `Missing details: ${fields.join(", ")}`,
      });
      expectNoSideEffects();
    };

    it.each(REQUIRED_FIELDS.filter((field) => field !== "image"))(
      "names '%s' when it is missing",
      async (field) => {
        const req = makeReq();
        delete req.body[field];
        const res = mockRes();

        await addCompanion(req, res);

        expectMissing(res, [field]);
      },
    );

    it("names 'image' when the image file is missing", async () => {
      const res = mockRes();

      await addCompanion(makeReq({}, null), res);

      expectMissing(res, ["image"]);
    });

    it("treats an empty string as missing", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ name: "" }), res);

      expectMissing(res, ["name"]);
    });

    it("lists every missing field, not just the first", async () => {
      const req = makeReq({}, null);
      delete req.body.email;
      delete req.body.fees;
      const res = mockRes();

      await addCompanion(req, res);

      expectMissing(res, ["email", "fees", "image"]);
    });

    it("lists missing fields in a fixed order regardless of how they are sent", async () => {
      // Same fields missing as above, but the body is built in a different order
      const { address, about, password, location, experience, name } = validBody();
      const req = { body: { address, about, password, location, experience, name }, file: null };
      const res = mockRes();

      await addCompanion(req, res);

      expectMissing(res, ["email", "fees", "image"]);
    });

    it("lists every field when the body is empty and no image is sent", async () => {
      const res = mockRes();

      await addCompanion({ body: {}, file: undefined }, res);

      expectMissing(res, REQUIRED_FIELDS);
    });

    it("lists every field when the request has no body at all", async () => {
      // Express 5 leaves req.body undefined when no body parser ran
      const res = mockRes();

      await addCompanion({}, res);

      expectMissing(res, REQUIRED_FIELDS);
    });

    it("does not list fields that are present", async () => {
      const req = makeReq({ location: "" });
      const res = mockRes();

      await addCompanion(req, res);

      const { message } = res.json.mock.calls[0][0];
      expect(message).toBe("Missing details: location");
      for (const field of REQUIRED_FIELDS.filter((f) => f !== "location")) {
        expect(message).not.toContain(field);
      }
    });

    it("checks for missing fields before validating the email", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ email: "not-an-email", fees: "" }), res);

      expectMissing(res, ["fees"]);
    });
  });

  describe("email validation", () => {
    it.each(["not-an-email", "jane@", "@example.com", "jane@example"])(
      "rejects invalid email '%s'",
      async (email) => {
        const res = mockRes();

        await addCompanion(makeReq({ email }), res);

        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: "Please enter a valid email",
        });
        expectNoSideEffects();
      },
    );
  });

  describe("password validation", () => {
    it.each([
      ["too short", "Pa0$wor", "Password must be at least 8 characters long"],
      [
        "no capital letter",
        "passw0rd$",
        "Password must contain at least one capital letter",
      ],
      [
        "no small letter",
        "PASSW0RD$",
        "Password must contain at least one small letter",
      ],
      [
        "no number",
        "Password$",
        "Password must contain at least one number",
      ],
      [
        "no special character",
        "Passw0rdd",
        "Password must contain at least one special character ($, &, %, +)",
      ],
    ])("rejects a password with %s", async (_case, password, message) => {
      const res = mockRes();

      await addCompanion(makeReq({ password }), res);

      expect(res.json).toHaveBeenCalledWith({ success: false, message });
      expectNoSideEffects();
    });

    it.each(["!", "@", "#", ";", "*", "-", "_", " "])(
      "does not count '%s' as an allowed special character",
      async (char) => {
        const res = mockRes();

        await addCompanion(makeReq({ password: `Passw0rd${char}` }), res);

        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message:
            "Password must contain at least one special character ($, &, %, +)",
        });
        expectNoSideEffects();
      },
    );

    it.each(["$", "&", "%", "+"])(
      "accepts '%s' as a special character",
      async (char) => {
        const password = `Passw0rd${char}`;
        const res = mockRes();

        await addCompanion(makeReq({ password }), res);

        expect(mocks.hash).toHaveBeenCalledWith(password, "salt");
        expect(res.json).toHaveBeenCalledWith({
          success: true,
          message: "Companion added",
        });
      },
    );

    it("accepts a password of exactly 8 characters", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ password: "Pa0$word" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Companion added",
      });
    });

    it("accepts the special character at any position", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ password: "+Passw0rd" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Companion added",
      });
    });

    it("accepts a password that also contains other special characters", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ password: "Passw0rd!$" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Companion added",
      });
    });

    it("rejects a non-string password", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ password: 12345678 }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Password must be at least 8 characters long",
      });
      expectNoSideEffects();
    });

    it("validates the email before the password", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ email: "bad", password: "weak" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Please enter a valid email",
      });
    });
  });

  describe("address validation", () => {
    it.each([
      ["not JSON", "not json"],
      ["truncated JSON", '{"line1": "123 Main St"'],
      ["JSON null", "null"],
      ["a JSON number", "123"],
      ["a JSON string", '"123 Main St"'],
      ["a JSON boolean", "true"],
      ["a JSON array", '["123 Main St", "Apt 4"]'],
      ["whitespace", "   "],
    ])(
      "rejects an address that is %s without uploading the image",
      async (_case, address) => {
        const res = mockRes();

        await addCompanion(makeReq({ address }), res);

        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: "Please enter a valid address",
        });
        expectNoSideEffects();
      },
    );

    it("saves the parsed address object, not the raw string", async () => {
      const address = { line1: "1 Riverside Dr", line2: "", city: "Nairobi" };

      await addCompanion(makeReq({ address: JSON.stringify(address) }), mockRes());

      expect(companionModel.mock.calls[0][0].address).toEqual(address);
    });

    it("accepts an empty address object", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ address: "{}" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Companion added",
      });
    });

    it("validates the password before the address", async () => {
      const res = mockRes();

      await addCompanion(makeReq({ password: "weak", address: "not json" }), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    });
  });

  describe("duplicate email", () => {
    it("rejects an email that is already registered without uploading the image", async () => {
      mocks.findOne.mockResolvedValue({ _id: "existing-id", email: "jane@example.com" });
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(mocks.findOne).toHaveBeenCalledWith({ email: "jane@example.com" });
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "A companion with this email already exists",
      });
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(companionModel).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.destroy).not.toHaveBeenCalled();
    });

    it("checks for a duplicate before uploading the image", async () => {
      await addCompanion(makeReq(), mockRes());

      expect(mocks.findOne.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.upload.mock.invocationCallOrder[0],
      );
    });

    it("looks up the email only after the request has been validated", async () => {
      // Invalid email, password and address all stop before the database query
      for (const override of [
        { email: "not-an-email" },
        { password: "weak" },
        { address: "not json" },
      ]) {
        await addCompanion(makeReq(override), mockRes());
      }

      expect(mocks.findOne).not.toHaveBeenCalled();
    });

    it("responds with the error message and does not upload when the lookup fails", async () => {
      mocks.findOne.mockRejectedValue(new Error("Database unavailable"));
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Database unavailable",
      });
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
    });
  });

  describe("image cleanup when saving fails", () => {
    it("deletes the uploaded image and responds with the save error", async () => {
      mocks.save.mockRejectedValue(new Error("companion validation failed"));
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.destroy).toHaveBeenCalledWith(IMAGE_PUBLIC_ID, {
        resource_type: "image",
      });
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "companion validation failed",
      });
    });

    it("deletes the image only after the save has failed", async () => {
      mocks.save.mockRejectedValue(new Error("save failed"));

      await addCompanion(makeReq(), mockRes());

      expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.destroy.mock.invocationCallOrder[0],
      );
    });

    it("deletes the image when a duplicate email slips past the check (concurrent requests)", async () => {
      // Another request saved the same email between the lookup and the save
      mocks.findOne.mockResolvedValue(null);
      mocks.save.mockRejectedValue(
        new Error('E11000 duplicate key error collection: companions index: email_1 dup key: { email: "jane@example.com" }'),
      );
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(mocks.destroy).toHaveBeenCalledWith(IMAGE_PUBLIC_ID, {
        resource_type: "image",
      });
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining("E11000 duplicate key error"),
      });
    });

    it("still responds with the save error when deleting the image also fails", async () => {
      const deleteError = new Error("Cloudinary delete failed");
      mocks.save.mockRejectedValue(new Error("save failed"));
      mocks.destroy.mockRejectedValue(deleteError);
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "save failed",
      });
      // The failed deletion is logged so the unused image can be found and removed
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(IMAGE_PUBLIC_ID),
        deleteError,
      );
    });

    it("does not delete anything when the upload itself fails", async () => {
      mocks.upload.mockRejectedValue(new Error("Cloudinary unavailable"));

      await addCompanion(makeReq(), mockRes());

      expect(mocks.destroy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("responds with the error message when the image upload fails", async () => {
      mocks.upload.mockRejectedValue(new Error("Cloudinary unavailable"));
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Cloudinary unavailable",
      });
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.destroy).not.toHaveBeenCalled();
    });

    it("responds with the error message when password hashing fails", async () => {
      mocks.hash.mockRejectedValue(new Error("hash failed"));
      const res = mockRes();

      await addCompanion(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "hash failed",
      });
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.destroy).not.toHaveBeenCalled();
    });

  });
});

// ---------------------------------------------------------------------------
// loginAdmin
// ---------------------------------------------------------------------------
describe("loginAdmin", () => {
  const ADMIN_EMAIL = "admin@joyful.com";
  const ADMIN_PASSWORD = "Adm1n$ecret";
  const JWT_SECRET = "test-jwt-secret";

  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
  });

  it("returns a signed token for valid admin credentials", async () => {
    const res = mockRes();

    await loginAdmin(
      { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } },
      res,
    );

    expect(mocks.sign).toHaveBeenCalledWith(
      ADMIN_EMAIL + ADMIN_PASSWORD,
      JWT_SECRET,
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      token: "signed-token",
    });
  });

  it.each([
    ["wrong email", { email: "someone@else.com", password: ADMIN_PASSWORD }],
    ["wrong password", { email: ADMIN_EMAIL, password: "wrong" }],
    ["both wrong", { email: "someone@else.com", password: "wrong" }],
    ["email with different case", { email: ADMIN_EMAIL.toUpperCase(), password: ADMIN_PASSWORD }],
    ["missing email", { password: ADMIN_PASSWORD }],
    ["missing password", { email: ADMIN_EMAIL }],
    ["empty body", {}],
  ])("rejects login with %s", async (_case, body) => {
    const res = mockRes();

    await loginAdmin({ body }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid credentials",
    });
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("responds with the error message when signing the token fails", async () => {
    mocks.sign.mockImplementation(() => {
      throw new Error("secretOrPrivateKey must have a value");
    });
    const res = mockRes();

    await loginAdmin(
      { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "secretOrPrivateKey must have a value",
    });
  });

  describe("when admin credentials are not configured", () => {
    // JWT_SECRET stays set (from the outer beforeEach) in every case below,
    // so a token *could* be signed - the controller must refuse anyway.
    const ENV_CASES = [
      ["ADMIN_EMAIL and ADMIN_PASSWORD are both missing", undefined, undefined],
      ["ADMIN_EMAIL is missing", undefined, ADMIN_PASSWORD],
      ["ADMIN_PASSWORD is missing", ADMIN_EMAIL, undefined],
      ["ADMIN_EMAIL and ADMIN_PASSWORD are both empty", "", ""],
      ["ADMIN_EMAIL is empty", "", ADMIN_PASSWORD],
      ["ADMIN_PASSWORD is empty", ADMIN_EMAIL, ""],
    ];

    // Request bodies an attacker could send to try to match the missing values
    const BODIES = [
      ["an empty body", {}],
      ["only the admin email", { email: ADMIN_EMAIL }],
      ["only the admin password", { password: ADMIN_PASSWORD }],
      ["the real admin credentials", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }],
      ["empty strings", { email: "", password: "" }],
      ["the admin email and an empty password", { email: ADMIN_EMAIL, password: "" }],
      ["an empty email and the admin password", { email: "", password: ADMIN_PASSWORD }],
    ];

    describe.each(ENV_CASES)("when %s", (_envCase, envEmail, envPassword) => {
      beforeEach(() => {
        vi.stubEnv("ADMIN_EMAIL", envEmail);
        vi.stubEnv("ADMIN_PASSWORD", envPassword);
      });

      it.each(BODIES)("refuses login with %s", async (_bodyCase, body) => {
        const res = mockRes();

        await loginAdmin({ body }, res);

        expect(mocks.sign).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: "Invalid credentials",
        });
      });
    });

    it("logs the misconfiguration on the server without revealing it to the client", async () => {
      vi.stubEnv("ADMIN_PASSWORD", undefined);
      const res = mockRes();

      await loginAdmin({ body: { email: ADMIN_EMAIL } }, res);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("ADMIN_PASSWORD"),
      );
      const response = JSON.stringify(res.json.mock.calls[0][0]);
      expect(response).not.toContain("ADMIN_");
    });
  });

  it("responds with success: false when the request has no body", async () => {
    const res = mockRes();

    await loginAdmin({}, res);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: expect.any(String),
    });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
