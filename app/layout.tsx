import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Link from "next/link";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "ATS — Applicant Tracking System",
  description: "Track jobs, candidates, and hiring pipelines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full bg-gray-50 text-gray-900 antialiased`}
      >
        {/* Navigation Bar */}
        <nav className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-indigo-600">
              ATS
            </Link>
            <div className="flex items-center gap-8">
              <Link href="/" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Dashboard
              </Link>
              <Link href="/jobs" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Jobs
              </Link>
              <Link href="/candidates" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Candidates
              </Link>
              <Link
                href="/jobs/new"
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                + Post Job
              </Link>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
