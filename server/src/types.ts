import type { Request } from "express";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
};

export type AuthedRequest = Request & {
  user?: AuthUser;
};
