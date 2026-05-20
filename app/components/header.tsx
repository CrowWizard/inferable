import Image from "next/image";
import logo from "./logo.png";

export function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between w-full h-16 pl-7 bg-white/95 backdrop-blur-sm border-b shadow-sm">
      <div className="flex flex-row items-center gap-4">
        <a
          href="/"
          className="flex items-center space-x-4 transition-transform duration-200 hover:scale-[1.02]"
        >
          <div className="flex items-center space-x-2 -ml-2">
            <Image src={logo} width={40} height={40} alt={"logo"} className="rounded-lg" />
            <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-600 via-gray-800 to-gray-600 bg-clip-text text-transparent tracking-tight">
              Inferable
            </h1>
          </div>
        </a>
      </div>
      <div className="flex items-center gap-4 pr-4">
        <span className="text-sm text-gray-500">Dev User</span>
      </div>
    </header>
  );
}
