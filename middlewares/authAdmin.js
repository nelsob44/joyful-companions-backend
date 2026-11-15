import jwt from "jsonwebtoken";

//admin authentication middleware
const authAdmin = async (req, res, next) => {
  try {
    const { adminToken } = req.headers;

    if (!adminToken) {
      return res.json({
        success: false,
        message: "Not Authorized Login again",
      });
    }

    const decoded_token = jwt.verify(adminToken, process.env.JWT_SECRET);

    if (
      decoded_token !==
      process.env.ADMIN_EMAIL + process.env.ADMIN_PASSWORD
    ) {
      return res.json({
        success: false,
        message: "Not Authorized Login again",
      });
    }
    next();
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export default authAdmin;
