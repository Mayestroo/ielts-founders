import { QueryProvider } from "@/components/providers/QueryProvider";
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
  other: {
    "google": "notranslate",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" translate="no" className="notranslate">
      <body className="antialiased notranslate">
        <QueryProvider>
          <AuthProvider>
            <SettingsProvider>{children}</SettingsProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
