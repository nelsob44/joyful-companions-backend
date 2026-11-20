import validator from "validator";
import bcrypt from "bcrypt";
import { v2 as cloudinary } from "cloudinary";
import companionModel from "../models/companionModel.js";
import jwt from "jsonwebtoken";

// Allowed special characters for passwords: $ & % +
const PASSWORD_SPECIAL_CHARS = /[$&%+]/;

// Returns an error message if the password is not strong enough, otherwise null
const getPasswordError = (password) => {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one capital letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one small letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  if (!PASSWORD_SPECIAL_CHARS.test(password)) {
    return "Password must contain at least one special character ($, &, %, +)";
  }
  return null;
};

// Parses the address JSON string sent in the form data.
// Returns the address object, or null if it is not a valid JSON object.
const parseAddress = (address) => {
  try {
    const parsed = JSON.parse(address);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // invalid JSON - fall through
  }
  return null;
};

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
    } = req.body ?? {};

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

    // check before adding companion: list every required field that is missing
    // ("image" is the multipart field name the image file is uploaded under)
    const requiredFields = {
      name,
      email,
      password,
      location,
      experience,
      about,
      fees,
      address,
      image: imageFile,
    };
    const missingFields = Object.keys(requiredFields).filter(
      (field) => !requiredFields[field],
    );
    if (missingFields.length > 0) {
      return res.json({
        success: false,
        message: `Missing details: ${missingFields.join(", ")}`,
      });
    }

    // validate email
    if (!validator.isEmail(email)) {
      return res.json({
        success: false,
        message: "Please enter a valid email",
      });
    }

    //validate password strength
    const passwordError = getPasswordError(password);
    if (passwordError) {
      return res.json({
        success: false,
        message: passwordError,
      });
    }

    // validate address before uploading the image, so an invalid address
    // never leaves an unused image on Cloudinary
    const parsedAddress = parseAddress(address);
    if (!parsedAddress) {
      return res.json({
        success: false,
        message: "Please enter a valid address",
      });
    }

    // check for a duplicate email before uploading the image, so a rejected
    // companion never leaves an unused image on Cloudinary
    const existingCompanion = await companionModel.findOne({ email });
    if (existingCompanion) {
      return res.json({
        success: false,
        message: "A companion with this email already exists",
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
      address: parsedAddress,
      date: Date.now(),
    };

    try {
      const newCompanion = new companionModel(companionData);

      await newCompanion.save();
    } catch (saveError) {
      // the companion was not saved, so delete the image uploaded for it
      try {
        await cloudinary.uploader.destroy(imageUpload.public_id, {
          resource_type: "image",
        });
      } catch (deleteError) {
        console.log(
          `Failed to delete unused Cloudinary image ${imageUpload.public_id}`,
          deleteError,
        );
      }
      // report the save error, not the delete error
      throw saveError;
    }

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

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Refuse every login if the admin credentials are not configured.
    // Otherwise missing request fields would match the missing env values
    // (undefined === undefined) and grant admin access.
    if (!adminEmail || !adminPassword) {
      console.log(
        "Admin login refused: ADMIN_EMAIL and/or ADMIN_PASSWORD is not set",
      );
      return res.json({ success: false, message: "Invalid credentials" });
    }

    if (email === adminEmail && password === adminPassword) {
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

const allCompanions = async (req, res) => {
  try {
    const companions = await companionModel.find({}).select("-password");

    res.json({ success: true, companions });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addCompanion, loginAdmin, allCompanions };
