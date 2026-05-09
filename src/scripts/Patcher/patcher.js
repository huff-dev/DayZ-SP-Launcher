const fs = require('fs');
const path = require('path');

/**
 * Patches a DayZ Server executable.
 * @param {string} filePath Path to the .exe file
 */
function patchFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        return false;
    }

    console.log(`Reading ${filePath}...`);
    let buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch (err) {
        console.error(`Error reading file: ${err.message}`);
        return false;
    }

    // Create backup if it doesn't exist or we want to overwrite
    const backupPath = filePath + '.bak';
    try {
        // Only create backup if it doesn't exist, to preserve the "original" clean copy
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, buffer);
            console.log(`Backup created: ${backupPath}`);
        } else {
            console.log(`Using existing backup: ${backupPath}`);
        }
    } catch (err) {
        console.error(`Error creating backup: ${err.message}`);
        return false;
    }

    /**
     * Scans for a hex pattern and applies a patch if found.
     * @param {string} patternStr Hex string pattern (use '?' for wildcards)
     * @param {number[]|Buffer} patchBytes Bytes to write
     * @param {string} label Descriptive name for the patch
     */
    function scanAndPatch(patternStr, patchBytes, label) {
        const pattern = patternStr.split(' ').map(x => x === '?' ? null : parseInt(x, 16));
        
        for (let i = 0; i <= buffer.length - pattern.length; i++) {
            let match = true;
            for (let j = 0; j < pattern.length; j++) {
                if (pattern[j] !== null && buffer[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const patchBuf = Buffer.isBuffer(patchBytes) ? patchBytes : Buffer.from(patchBytes);
                patchBuf.copy(buffer, i);
                console.log(`Applied patch: ${label}`);
                return true;
            }
        }
        console.log(`Pattern not found for: ${label}`);
        return false;
    }

    let patched = false;

    // 1. Patch BattlEye Init
    if (scanAndPatch(
        "40 53 55 56 57 41 54 48 81 EC ? ? ? ? 45 33 E4 48 8B D9 44 89",
        [0xB0, 0x01, 0xC3],
        "BattlEye Init"
    )) patched = true;

    // 2. Patch VAC Check
    if (scanAndPatch(
        "74 44 0F B7 C8 E8 ? ? ? ? 8B 13 44 0F B7 C0 44 89 4C 24 ? 48",
        [0xEB],
        "VAC Check"
    )) patched = true;

    // 3. Patch Title
    const newTitle = Buffer.alloc(15, 0);
    Buffer.from("Patched version").copy(newTitle);
    if (scanAndPatch(
        "43 6F 6E 73 6F 6C 65 20 76",
        newTitle,
        "Server Title"
    )) patched = true;

    if (patched) {
        try {
            fs.writeFileSync(filePath, buffer);
            console.log("File patched and saved successfully.");
            return true;
        } catch (err) {
            console.error(`Error saving patched file: ${err.message}`);
            return false;
        }
    }
    return false;
}

/**
 * Restores the original DayZ Server executable from backup.
 * @param {string} filePath Path to the .exe file
 */
function restoreFile(filePath) {
    const backupPath = filePath + '.bak';
    if (fs.existsSync(backupPath)) {
        try {
            // Check if the current file is actually different (optional, but safer)
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            fs.copyFileSync(backupPath, filePath);
            // We keep the backup so we can patch again later
            console.log(`Restored original file from ${backupPath}`);
            return true;
        } catch (err) {
            console.error(`Error restoring file: ${err.message}`);
            return false;
        }
    } else {
        console.log("No backup found to restore.");
        return false;
    }
}

module.exports = {
    patchFile,
    restoreFile
};

// CLI Execution
if (require.main === module) {
    const target = process.argv[2];
    if (target) {
        patchFile(path.resolve(target));
    } else {
        console.log("Usage: node patcher.js <path_to_dayz_server_exe>");
    }
}
