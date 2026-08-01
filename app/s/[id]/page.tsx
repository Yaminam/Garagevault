import { ShareView } from '@/components/ShareView.tsx';

export const metadata = {
  title: 'Shared secret',
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareView id={id} />;
}
