import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IELTS Mock Exam - Student Portal",
  description: "Take your IELTS practice exam",
  icons: {
    icon: [
      {
        url: '/favicon.png',
        sizes: '16x16',
        type: 'image/png',
      },
      {
        url: '/favicon.png',
        sizes: '32x32',
        type: 'image/png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
