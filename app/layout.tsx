import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Master Prep | KFD Promotional Study";
const description = "A focused study tool for KFD senior firefighters preparing for the Master Firefighter promotional exam.";

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title,
    description,
    openGraph: {
      title: "Master Prep",
      description: "Train for the score that earns the interview.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1748, height: 907, alt: "Master Prep study dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Master Prep",
      description: "Train for the score that earns the interview.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
