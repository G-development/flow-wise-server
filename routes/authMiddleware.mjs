import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token)
    return res.status(401).json({ msg: "Access denied, missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("AuthMiddleware | Decoded JWT:", decoded);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ msg: "Token is not valid" });
  }
};
