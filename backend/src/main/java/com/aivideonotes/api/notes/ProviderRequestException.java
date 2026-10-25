package com.aivideonotes.api.notes;

public class ProviderRequestException extends RuntimeException {

	public ProviderRequestException(String message) {
		super(message);
	}

	public ProviderRequestException(String message, Throwable cause) {
		super(message, cause);
	}
}
