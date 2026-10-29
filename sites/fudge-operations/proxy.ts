import { freebuff } from "./lib/freebuff";

export const proxy = freebuff.proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"],
};
