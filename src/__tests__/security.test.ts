import type { Request, Response } from "express";
import { sanitizeInput } from "../app/middlewares/sanitizeInput";
import { uploadKind } from "../app/config/multer.config";

describe("Security: uploads", () => {
  const file = (originalname: string, mimetype: string) => ({ originalname, mimetype });

  it("accepts what the app sends: photos, voice notes, PDF CVs", () => {
    expect(uploadKind(file("photo.jpg", "image/jpeg"))).toBe("image");
    expect(uploadKind(file("IMG_0001.HEIC", "image/heic"))).toBe("image");
    expect(uploadKind(file("logo.png", "image/png"))).toBe("image");
    expect(uploadKind(file("voice.m4a", "audio/mp4"))).toBe("audio");
    expect(uploadKind(file("voice.webm", "audio/webm"))).toBe("audio");
    expect(uploadKind(file("Mon CV.PDF", "application/pdf"))).toBe("pdf");
  });

  it("accepts a known type without an extension (some Android pickers)", () => {
    expect(uploadKind(file("document:1234", "application/pdf"))).toBe("pdf");
  });

  it("refuses pages, scripts, programs and disguised files", () => {
    expect(uploadKind(file("page.html", "text/html"))).toBeNull();
    expect(uploadKind(file("logo.svg", "image/svg+xml"))).toBeNull();
    expect(uploadKind(file("app.apk", "application/vnd.android.package-archive"))).toBeNull();
    expect(uploadKind(file("run.exe", "application/octet-stream"))).toBeNull();
    // Declared as a photo but named like a page
    expect(uploadKind(file("photo.html", "image/jpeg"))).toBeNull();
    expect(uploadKind(file("cv.pdf.js", "application/pdf"))).toBeNull();
  });
});

describe("Security: input sanitizing", () => {
  const run = (body: Record<string, unknown>, query: Record<string, string> = {}) => {
    const req = { body, params: {}, headers: {}, query } as unknown as Request;
    sanitizeInput(req, {} as Response, jest.fn());
    return req;
  };

  it("keeps & as typed instead of storing &amp;", () => {
    const req = run({ name: "Riz & Co", items: [{ label: "A & B" }] }, { searchTerm: "Riz & Co" });
    expect(req.body).toEqual({ name: "Riz & Co", items: [{ label: "A & B" }] });
    expect(req.query).toEqual({ searchTerm: "Riz & Co" });
  });

  it("still strips scripts and keeps < > escaped", () => {
    const req = run({ name: "<script>alert(1)</script>Shop", bio: "&lt;img src=x onerror=alert(1)&gt;" });
    expect(req.body.name).toBe("Shop");
    expect(req.body.bio).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("leaves passwords encoded as before, so existing logins still match", () => {
    const req = run({ password: "p&ss", oldPassword: "a&b", newPassword: "c&d" });
    expect(req.body).toEqual({ password: "p&amp;ss", oldPassword: "a&amp;b", newPassword: "c&amp;d" });
  });
});
