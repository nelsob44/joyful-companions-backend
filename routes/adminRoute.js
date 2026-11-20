import express from "express";

import {
  addCompanion,
  allCompanions,
  loginAdmin,
} from "../controllers/adminController.js";

import upload from "../middlewares/multer.js";
import authAdmin from "../middlewares/authAdmin.js";
import { changeAvailability } from "../controllers/companionController.js";

const adminRouter = express.Router();

adminRouter.post(
  "/add-companion",
  authAdmin,
  upload.single("image"),
  addCompanion,
);
adminRouter.post("/login", loginAdmin);
adminRouter.post("/all-companions", authAdmin, allCompanions);
adminRouter.post("/change-availability", authAdmin, changeAvailability);

export default adminRouter;
