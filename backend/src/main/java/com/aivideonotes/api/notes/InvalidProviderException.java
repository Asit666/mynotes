package com.aivideonotes.api.notes;

public class InvalidProviderException extends RuntimeException {

	public InvalidProviderException() {
		super("Choose OpenAI, Anthropic, or Google Gemini.");
	}
}
