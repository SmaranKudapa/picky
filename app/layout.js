import "./globals.css";

export const metadata = {
  title: "picky",
  description: "Ends the 'idk, where do you want to eat?' loop.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fff6ec",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
