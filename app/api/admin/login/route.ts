import { cookies } from "next/headers";
import { checkPassword, signSession, COOKIE_NAME } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const { password } = (await req.json()) as { password?: string };
  if (!password || !checkPassword(password)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return Response.json({ ok: true });
}
