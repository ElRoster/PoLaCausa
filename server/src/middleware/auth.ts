import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { AuthedRequest, AuthUser } from "../types.js";

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "No autorizado" });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret) as AuthUser;
    return next();
  } catch {
    return res.status(401).json({ message: "Sesion invalida o vencida" });
  }
}

export function requirePermission(permission: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const permissions = req.user?.permissions ?? [];
    if (permissions.includes("all") || permissions.includes(permission)) {
      return next();
    }
    return res.status(403).json({ message: "Permisos insuficientes" });
  };
}
