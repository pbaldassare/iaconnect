import "server-only";
import {
  type ApiConversation,
  type ApiMessage,
  type ApiOrganization,
  type PlatformApiStore,
  PlatformApiUnavailable,
  platformApiErrorFrom,
} from "@/lib/platform-api";
import { MissingServiceKeyError, createServiceClient } from "@/lib/supabase/service";

function client() {
  try {
    return createServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceKeyError) throw new PlatformApiUnavailable();
    throw error;
  }
}

function raise(error: { code?: string | null; message?: string | null }): never {
  throw platformApiErrorFrom(error) ?? new Error("internal");
}

/**
 * Reads through the service role, which can execute the api_* functions and
 * nothing else on behalf of the caller: the hash is the only credential, and
 * the functions enforce the key's organization.
 */
export function platformApiStore(): PlatformApiStore {
  return {
    async organizations(keyHash) {
      const { data, error } = await client().rpc("api_organizations", { p_hash: keyHash });
      if (error) raise(error);
      return (data ?? []) as ApiOrganization[];
    },
    async conversations(keyHash, organizationId, limit, before) {
      const { data, error } = await client().rpc("api_conversations", {
        p_hash: keyHash,
        p_organization: organizationId,
        p_limit: limit,
        p_before: before,
      });
      if (error) raise(error);
      return (data ?? []) as ApiConversation[];
    },
    async messages(keyHash, organizationId, conversationId, limit, before) {
      const { data, error } = await client().rpc("api_messages", {
        p_hash: keyHash,
        p_organization: organizationId,
        p_conversation: conversationId,
        p_limit: limit,
        p_before: before,
      });
      if (error) raise(error);
      return (data ?? []) as ApiMessage[];
    },
  };
}
