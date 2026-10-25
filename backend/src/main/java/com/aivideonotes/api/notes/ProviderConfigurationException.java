package com.aivideonotes.api.notes;

public class ProviderConfigurationException extends RuntimeException {

	public ProviderConfigurationException() {
		this("The selected AI provider is not configured. Add its API key in Settings.");
	}

	public ProviderConfigurationException(String message) {
		super(message);
	}
}
