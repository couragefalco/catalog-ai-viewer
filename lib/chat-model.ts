import { createAzure } from "@ai-sdk/azure";
import { google } from "@ai-sdk/google";

// Zentrale Modellwahl für Chat + Anreicherung: Azure-Deployment (igus),
// Gemini nur als Fallback, falls keine Azure-Konfiguration gesetzt ist.
export function getChatModel() {
  const azureApiKey = process.env.AZURE_API_KEY;
  const azureChatDeployment = process.env.AZURE_CHAT_DEPLOYMENT;
  const azureResourceName = process.env.AZURE_RESOURCE_NAME;
  const azureOpenAiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const hasAzure =
    azureApiKey &&
    azureChatDeployment &&
    (azureResourceName || azureOpenAiEndpoint);

  if (hasAzure) {
    const azure = createAzure({
      apiKey: azureApiKey,
      resourceName: azureResourceName,
      baseURL: azureOpenAiEndpoint,
    });
    console.log(`chat provider: azure (${azureChatDeployment})`);
    return azure.chat(azureChatDeployment);
  }

  console.log("chat provider: google (gemini-2.5-flash)");
  return google("gemini-2.5-flash");
}
