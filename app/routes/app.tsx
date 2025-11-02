import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app">Accueil</Link>
        <Link to="/app/referrers">Parrains</Link>
        <Link to="/app/add-referrer">Ajouter un parrain</Link>
        <Link to="/app/workshops">Workshops</Link>
        <Link to="/app/rewards">Récompenses</Link>
        <Link to="/app/statistics">Statistiques</Link>
        <Link to="/app/email-templates">Templates Emails</Link>
        <Link to="/app/settings">Paramètres</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}
