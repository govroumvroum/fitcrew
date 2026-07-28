import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  // -ml-18 cancels the body's rail offset — there's no rail when signed out.
  return (
    <div className="flex min-h-screen items-center justify-center md:-ml-18">
      <SignUp />
    </div>
  );
}
