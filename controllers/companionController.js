import companionModel from "../models/companionModel.js";

const changeAvailability = async (req, res) => {
  try {
    const { compId } = req.body;

    const compData = await companionModel.findById(compId);
    await companionModel.findByIdAndUpdate(compId, {
      available: !compData.available,
    });
    res.json({ success: true, message: "Availability Changed" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

const companionList = async (req, res) => {
  try {
    const companions = await companionModel
      .find({})
      .select(["-password", "-email"]);
    res.json({ success: true, companions });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export { changeAvailability, companionList };
