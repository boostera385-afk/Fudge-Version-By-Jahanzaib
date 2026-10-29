// Legacy direct writer settings. The normal writer now uses the connected Apps
// Script, with FUDGE_OPENAI_API_KEY stored in its Script properties. Keep apiKey
// empty so the OpenAI key is not exposed in the unpacked extension folder.

const FUDGE_AI = {
  apiKey: "",
  url: "https://api.openai.com/v1/chat/completions",
  model: "gpt-5.6-luna"
};

// Supabase is Fudge's primary database. The publishable key identifies the
// project; all data access still passes through the authenticated Edge Function.
const FUDGE_SUPABASE = {
  projectRef: "exxknotrmrimwwuyhjqx",
  url: "https://exxknotrmrimwwuyhjqx.supabase.co",
  publishableKey: "sb_publishable_g4xF8MrJJ7lmI4Itjf71Ww_1eLKxkt4",
  functionUrl: "https://exxknotrmrimwwuyhjqx.supabase.co/functions/v1/fudge-backend",
  workspaceId: "c0dd5276-09eb-402b-8a67-b2192d39988e",
  connectionToken: "6d94db6ae4cb46aeb93a8e7edc96b5b693d0878cfeef4e5382174ab2f1442ce6"
};
