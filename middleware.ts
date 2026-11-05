import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isOwner } from "@/lib/auth/owner";
import { frameAncestors } from "@/lib/publish/schema";

const PUBLIC_PATHS = ["/login", "/setup"];

/** Channel publik: tanpa login sama sekali (link, widget, API publik, skrip widget). */
const OPEN_PREFIXES = ["/c/", "/embed/", "/api/public/"];

/** Domain yang boleh memasang widget bot ini, untuk header CSP frame-ancestors. */
async function embedAncestors(slug: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "'self'";
  try {
    const r = await fetch(`${url}/rest/v1/bots?select=allowed_domains&is_public=eq.true&slug=eq.${encodeURIComponent(slug)}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!r.ok) return "'self'";
    const rows = (await r.json()) as { allowed_domains?: string[] }[];
    return frameAncestors(rows[0]?.allowed_domains ?? []);
  } catch {
    return "'self'";
  }
}

export async function middleware(request: NextRequest) {
  const p = request.nextUrl.pathname;
  if (p === "/widget.js" || OPEN_PREFIXES.some((x) => p.startsWith(x))) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex");
    if (p.startsWith("/embed/")) {
      res.headers.set("Content-Security-Policy", `frame-ancestors ${await embedAncestors(p.split("/")[2] ?? "")}`);
    } else if (p.startsWith("/c/")) {
      res.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
    }
    return res;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user: rawUser },
  } = await supabase.auth.getUser();
  const user = isOwner(rawUser) ? rawUser : null;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesi berakhir. Silakan login lagi." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
