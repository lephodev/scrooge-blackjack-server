import crypto from 'crypto';

export const decryptPass = (encryptedPassword) => {
	try {
    console.log("encryptedPassword",encryptedPassword);
		const algorithm = 'aes-192-cbc';
		const password = "gvytbffvsca#a%#$%#$j^$m#NHM4A645335";
		const key = crypto.scryptSync(password, 'salt', 24);
		const iv = Buffer.alloc(16, 0);
		const decipher = crypto.createDecipheriv(algorithm, key, iv);
		const encrypted = encryptedPassword;
		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	} catch (e) {
		return null;
	}
};