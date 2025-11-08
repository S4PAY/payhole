import ConnectionBanner from '@/components/dashboard/ConnectionBanner';
import PaymentVerification from '@/components/dashboard/PaymentVerification';
import ProxyOnboarding from '@/components/dashboard/ProxyOnboarding';
import DashboardCards from '@/components/dashboard/DashboardCards';
import ProxyStatusCard from '@/components/proxy/ProxyStatusCard';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
      <ConnectionBanner />
      <PaymentVerification />
      <ProxyStatusCard />
      <section className="rounded-xl border border-slate-200 bg-gradient-to-tr from-slate-900 via-slate-800 to-indigo-800 p-6 text-white shadow-md">
        <h2 className="text-2xl font-semibold">Pulse</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-200">
          PayHole keeps ads respectful and payments instant. Review real-time stats below or drill into a module to tune policies.
        </p>
      </section>
      <ProxyOnboarding />
      <DashboardCards />
    </main>
  );
}
