const os = require('os');
const fs = require('fs');
const path = require('path');

// Function to read the MAC address of the system's primary network interface
function getMACAddress() {
    const networkInterfaces = os.networkInterfaces();
    const primaryInterface = Object.values(networkInterfaces)
        .flatMap(interfaces => interfaces)
        .find(intf => !intf.internal && intf.mac);

    if (primaryInterface) {
        const primaryMAC = primaryInterface.mac.toUpperCase();
        return primaryMAC;
    } else {
        console.error("Unable to determine the MAC address of the primary network interface.");
        return null;
    }
}

// Function to store the MAC address in a file
function storeMACAddress(macAddress) {
    try {
        const filePath = path.join('public', 'mac_address.txt');
        if (!fs.existsSync(filePath)) { // Check if the file exists
            fs.writeFileSync(filePath, '');
            //console.log("MAC address file created successfully.");
        }
        fs.writeFileSync(filePath, macAddress);
        //console.log("MAC address stored successfully.");
    } catch (error) {
        console.error("Error storing the MAC address:", error);
    }
}

// Function to fetch the stored MAC address from the file
function fetchMACAddress(currentMAC) {
    try {
        const filePath = path.join('public/', 'mac_address.txt');
        if (fs.existsSync(filePath)) { // Check if the file exists
            const storedMAC = fs.readFileSync(filePath, 'utf8').trim();
            return storedMAC;
        } else {
            //console.log("MAC address file does not exist. Creating a new one.");
            storeMACAddress(currentMAC); // Pass the currentMAC to storeMACAddress
            return currentMAC; // Return the currentMAC since it's newly stored
        }
    } catch (error) {
        console.error("Error reading the stored MAC address:", error);
        return null;
    }
}


// Function to compare MAC addresses
function compareMACAddresses() {
    const currentMAC = getMACAddress();
    if (currentMAC === null) {
        console.error("Failed to retrieve current MAC address.");
        return false;
    }

    const storedMAC = fetchMACAddress(currentMAC);
    if (storedMAC === null) {
        console.error("Failed to retrieve stored MAC address.");
        return false;
    }

    if (storedMAC === '') {
        storeMACAddress(currentMAC);
        //console.log("Stored new MAC address:", currentMAC);
        return true;
    }

    if (currentMAC === storedMAC) {
        //console.log("MAC addresses match.");
        return true;
    } else {
        //console.log("MAC addresses do not match.");
        return false;
    }
}

module.exports = { compareMACAddresses };
