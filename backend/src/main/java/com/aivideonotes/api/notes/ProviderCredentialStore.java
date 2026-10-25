package com.aivideonotes.api.notes;

public interface ProviderCredentialStore {
	void save(AiProvider provider, String apiKey);

	String get(AiProvider provider);

	boolean isConfigured(AiProvider provider);

	void delete(AiProvider provider);
}
