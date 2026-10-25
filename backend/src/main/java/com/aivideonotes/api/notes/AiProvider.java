package com.aivideonotes.api.notes;

public enum AiProvider {
	OPENAI("OpenAI"),
	ANTHROPIC("Anthropic Claude"),
	GEMINI("Google Gemini");

	private final String displayName;

	AiProvider(String displayName) {
		this.displayName = displayName;
	}

	public String displayName() {
		return displayName;
	}

	public static AiProvider from(String value) {
		try {
			return valueOf(value.strip().toUpperCase());
		} catch (IllegalArgumentException | NullPointerException exception) {
			throw new InvalidProviderException();
		}
	}
}
