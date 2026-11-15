import validator from "validator";
import bcrypt from "bcrypt";
import { v2 as cloudinary } from "cloudinary";
import companionModel from "../models/companionModel.js";
import jwt from "jsonwebtoken";

// API to add companion
const addCompanion = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      location,
      experience,
      about,
      fees,
      address,
    } = req.body;

    const imageFile = req.file;

    console.log(
      {
        name,
        email,
        password,
        location,
        experience,
        about,
        fees,
        address,
      },
      imageFile,
    );

    // check before adding companion
    if (
      !name ||
      !email ||
      !password ||
      !location ||
      !experience ||
      !fees ||
      !about ||
      !address ||
      !imageFile
    ) {
      return res.json({ success: false, message: "Missing details" });
    }

    // validate email
    if (!validator.isEmail(email)) {
      return res.json({
        success: false,
        message: "Please enter a valid email",
      });
    }

    //validate password
    if (password.length < 8) {
      return res.json({
        success: false,
        message: "Please enter a strong password",
      });
    }

    //hashing companion password
    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(password, salt);

    //upload image to cloudinary
    const imageUpload = await cloudinary.uploader.upload(imageFile.path, {
      resource_type: "image",
    });

    const imageUrl = imageUpload.secure_url;

    const companionData = {
      name,
      email,
      image: imageUrl,
      password: hashedPassword,
      location,
      experience,
      about,
      fees,
      address: JSON.parse(address),
      date: Date.now(),
    };

    const newCompanion = new companionModel(companionData);

    await newCompanion.save();

    res.json({ success: true, message: "Companion added" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

//API for admin login
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(email + password, process.env.JWT_SECRET);
      res.json({ success: true, token });
    } else {
      res.json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addCompanion, loginAdmin };
