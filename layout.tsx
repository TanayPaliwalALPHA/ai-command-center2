import "./globals.css";
export const metadata = { title: "AI Command Center", description: "Four AIs, one request." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>{children}</body></html>);
}
