import { AuthForm } from '@/app/(auth)/sign-in/auth-form';

interface SignInPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  return <AuthForm initialError={params.error ?? null} />;
}
