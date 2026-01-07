import { ZodError } from "zod";

export const validate = (schema, source = "body") => (req, res, next) => {
  try {
    const data = req[source] || {};
    const parsed = schema.parse(data);
    req[source] = parsed;
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      });
    }
    next(err);
  }
};
