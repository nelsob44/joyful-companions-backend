import express from "express";
import { companionList } from "../controllers/companionController.js";
const companionRouter = express.Router();

companionRouter.get("/list", companionList);

export default companionRouter;
