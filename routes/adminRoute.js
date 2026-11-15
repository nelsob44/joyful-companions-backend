import express from "express";

import { addCompanion, loginAdmin } from "../controllers/adminController.js";

import upload from "../middlewares/multer.js";
import authAdmin from "../middlewares/authAdmin.js";

const adminRouter = express.Router();

adminRouter.post(
  "/add-companion",
  authAdmin,
  upload.single("image"),
  addCompanion,
);
adminRouter.post("/login", loginAdmin);

export default adminRouter;
