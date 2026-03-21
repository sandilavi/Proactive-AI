import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProActiveAI | Task Manager",
  description: "Your Intelligent Notion Task Agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
