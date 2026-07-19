import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-center text-2xl font-bold text-slate-900">Create an account</h1>
      <RegisterForm />
    </div>
  );
}
