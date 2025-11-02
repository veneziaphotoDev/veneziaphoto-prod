import { callAdminGraphql } from "./shopifyAdmin.server";

type ShopifyCustomer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

const FIND_CUSTOMER_QUERY = `
  query FindCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          email
          firstName
          lastName
        }
      }
    }
  }
`;

const CREATE_CUSTOMER_MUTATION = `
  mutation CreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
        firstName
        lastName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function normalizeCustomer(node: any): ShopifyCustomer | null {
  if (!node?.id || !node?.email) return null;
  const gid = String(node.id);
  const numericId = gid.split("/").pop() ?? gid;

  return {
    id: numericId,
    email: String(node.email),
    firstName: node.firstName ?? null,
    lastName: node.lastName ?? null,
  };
}

export async function findCustomerByEmail(email: string, shopDomain?: string | null): Promise<ShopifyCustomer | null> {
  const query = `email:"${email}"`;

  const response = await callAdminGraphql<{
    data?: { customers?: { edges?: Array<{ node?: any }> } };
  }>({
    query: FIND_CUSTOMER_QUERY,
    variables: { query },
    shopDomain,
  });

  const node = response.data?.customers?.edges?.[0]?.node;
  return normalizeCustomer(node);
}

export async function createCustomer(
  input: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  shopDomain?: string | null,
): Promise<ShopifyCustomer> {
  const response = await callAdminGraphql<{
    data?: {
      customerCreate?: {
        customer?: any;
        userErrors?: Array<{ field?: Array<string>; message?: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  }>({
    query: CREATE_CUSTOMER_MUTATION,
    variables: {
      input: {
        email: input.email,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
      },
    },
    shopDomain,
  });

  const createPayload = response.data?.customerCreate;
  if (!createPayload) {
    const firstError = response.errors?.[0]?.message;
    throw new Error(firstError ?? "Réponse inattendue de Shopify lors de la création du client.");
  }

  if (createPayload.userErrors && createPayload.userErrors.length > 0) {
    const message = createPayload.userErrors
      .map((error) => {
        const field = error.field?.join(".") ?? null;
        const msg = error.message ?? null;
        if (field && msg) return `${field}: ${msg}`;
        return msg ?? field ?? "";
      })
      .filter(Boolean)
      .join(" | ");
    throw new Error(message || "Impossible de créer le client Shopify (erreur inconnue).");
  }

  const normalized = normalizeCustomer(createPayload.customer);
  if (!normalized) {
    throw new Error("Impossible de créer le client Shopify: réponse invalide.");
  }

  return normalized;
}

export async function getOrCreateCustomerByEmail(
  input: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  shopDomain?: string | null,
): Promise<{ customer: ShopifyCustomer; created: boolean }> {
  const existing = await findCustomerByEmail(input.email, shopDomain);
  if (existing) {
    return { customer: existing, created: false };
  }

  const createdCustomer = await createCustomer(
    {
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    },
    shopDomain,
  );

  return { customer: createdCustomer, created: true };
}

