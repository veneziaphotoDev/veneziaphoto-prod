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
  // Vérifier d'abord si le client existe déjà
  const existing = await findCustomerByEmail(input.email, shopDomain);
  if (existing) {
    return { customer: existing, created: false };
  }

  // Essayer de créer le client
  try {
    const createdCustomer = await createCustomer(
      {
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      },
      shopDomain,
    );

    return { customer: createdCustomer, created: true };
  } catch (error) {
    // Si l'erreur indique que l'email est déjà pris, c'est probablement une race condition
    // Réessayons de trouver le client (il a peut-être été créé entre-temps par un autre processus)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isEmailTakenError = errorMessage.includes("Email has already been taken") || 
                              errorMessage.includes("email:") ||
                              errorMessage.toLowerCase().includes("email");
    
    if (isEmailTakenError) {
      // Faire plusieurs tentatives avec délai croissant (Shopify peut mettre du temps à indexer)
      // On fait jusqu'à 5 tentatives avec des délais de plus en plus longs
      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = 300 * (attempt + 1); // 300ms, 600ms, 900ms, 1200ms, 1500ms
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        const retryExisting = await findCustomerByEmail(input.email, shopDomain);
        if (retryExisting) {
          // Client trouvé après race condition, tout va bien
          return { customer: retryExisting, created: false };
        }
      }
      // Si après 5 tentatives on ne trouve toujours pas, c'est étrange mais on continue quand même
      // car le client existe (l'erreur le confirme), on va juste réessayer une dernière fois
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const finalRetry = await findCustomerByEmail(input.email, shopDomain);
      if (finalRetry) {
        return { customer: finalRetry, created: false };
      }
    }
    
    // Si on n'a toujours pas trouvé le client après plusieurs tentatives, relancer l'erreur
    throw error;
  }
}

