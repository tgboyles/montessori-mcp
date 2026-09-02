import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "./jwt.js";

declare global {
  namespace Express {
    interface Request {
      principal: AccessTokenPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  const token = header.slice(7);
  try {
    req.principal = await verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or expired token" },
      id: null,
    });
  }
}
