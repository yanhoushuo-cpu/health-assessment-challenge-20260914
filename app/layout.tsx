import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "青禾健康评估",
  description: "一份安静、清晰的个人健康评估演示。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
