package com.aivideonotes.api.notes;

import java.nio.charset.StandardCharsets;

import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;
import com.sun.jna.platform.win32.WinBase.FILETIME;
import com.sun.jna.win32.W32APITypeMapper;
import com.sun.jna.win32.W32APIOptions;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.StdCallLibrary;
import org.springframework.stereotype.Component;

@Component
public class WindowsCredentialStore implements ProviderCredentialStore {

	private static final int CREDENTIAL_TYPE_GENERIC = 1;
	private static final int CREDENTIAL_PERSIST_LOCAL_MACHINE = 2;
	private static final int ERROR_NOT_FOUND = 1168;
	private static final String TARGET_PREFIX = "AI Video Notes/";

	private final CredentialApi api;

	public WindowsCredentialStore() {
		this(CredentialApi.INSTANCE);
	}

	WindowsCredentialStore(CredentialApi api) {
		this.api = api;
	}

	@Override
	public void save(AiProvider provider, String apiKey) {
		requireWindows();
		byte[] bytes = (apiKey + "\0").getBytes(StandardCharsets.UTF_16LE);
		try (var blob = new Memory(bytes.length)) {
			blob.write(0, bytes, 0, bytes.length);
			var credential = new Credential();
			credential.type = CREDENTIAL_TYPE_GENERIC;
			credential.targetName = TARGET_PREFIX + provider.name();
			credential.credentialBlobSize = bytes.length;
			credential.credentialBlob = blob;
			credential.persist = CREDENTIAL_PERSIST_LOCAL_MACHINE;
			credential.userName = "AI Video Notes";
			credential.write();
			if (!api.CredWrite(credential, 0)) {
				throw new IllegalStateException("Windows Credential Manager could not save this provider key. Windows error " + Native.getLastError() + ".");
			}
		}
	}

	@Override
	public String get(AiProvider provider) {
		requireWindows();
		var pointer = new PointerByReference();
		if (!api.CredRead(TARGET_PREFIX + provider.name(), CREDENTIAL_TYPE_GENERIC, 0, pointer)) {
			if (Native.getLastError() == ERROR_NOT_FOUND) return "";
			throw new IllegalStateException("Windows Credential Manager could not read this provider key. Windows error " + Native.getLastError() + ".");
		}
		try {
			var credential = new Credential(pointer.getValue());
			credential.read();
			byte[] bytes = credential.credentialBlob.getByteArray(0, credential.credentialBlobSize);
			return new String(bytes, StandardCharsets.UTF_16LE).replaceFirst("\u0000+$", "");
		} finally {
			api.CredFree(pointer.getValue());
		}
	}

	@Override
	public boolean isConfigured(AiProvider provider) {
		return !get(provider).isBlank();
	}

	@Override
	public void delete(AiProvider provider) {
		requireWindows();
		if (!api.CredDelete(TARGET_PREFIX + provider.name(), CREDENTIAL_TYPE_GENERIC, 0)
				&& Native.getLastError() != ERROR_NOT_FOUND) {
			throw new IllegalStateException("Windows Credential Manager could not remove this provider key. Windows error " + Native.getLastError() + ".");
		}
	}

	private static void requireWindows() {
		if (!System.getProperty("os.name", "").toLowerCase().contains("windows")) {
			throw new IllegalStateException("Provider key storage requires Windows Credential Manager.");
		}
	}

	private interface CredentialApi extends StdCallLibrary {
		CredentialApi INSTANCE = Native.load("Advapi32", CredentialApi.class, W32APIOptions.UNICODE_OPTIONS);

		boolean CredWrite(Credential credential, int flags);

		boolean CredRead(String targetName, int type, int flags, PointerByReference credential);

		boolean CredDelete(String targetName, int type, int flags);

		void CredFree(Pointer credential);
	}

	@Structure.FieldOrder({
		"flags", "type", "targetName", "comment", "lastWritten", "credentialBlobSize",
		"credentialBlob", "persist", "attributeCount", "attributes", "targetAlias", "userName"
	})
	public static class Credential extends Structure {
		public int flags;
		public int type;
		public String targetName;
		public String comment;
		public FILETIME lastWritten = new FILETIME();
		public int credentialBlobSize;
		public Pointer credentialBlob;
		public int persist;
		public int attributeCount;
		public Pointer attributes;
		public String targetAlias;
		public String userName;

		Credential() {
			super(W32APITypeMapper.UNICODE);
		}

		Credential(Pointer pointer) {
			super(pointer, ALIGN_DEFAULT, W32APITypeMapper.UNICODE);
		}
	}
}
