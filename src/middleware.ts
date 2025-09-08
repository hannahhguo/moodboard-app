import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (pathname !== "/") return NextResponse.next();

  // ✅ Allow "/" only if skipIntro=1 is present
  if (searchParams.get("skipIntro") === "1") {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/intro";
  return NextResponse.redirect(url);
}


export const config = {
  matcher: ["/"], // only guard the landing page
};
