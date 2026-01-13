/**
 * FTM Schema Service - Provides FollowTheMoney schema definitions for entities.
 * 
 * This service provides pre-compiled FTM schema definitions with inheritance resolution.
 * The schemas are based on the YAML files in the ftm/ folder.
 */

export interface FTMPropertyDefinition {
    label: string;
    type?: string;
    description?: string;
    hidden?: boolean;
    matchable?: boolean;
    deprecated?: boolean;
    format?: string;
    maxLength?: number;
    range?: string;
    reverse?: {
        name: string;
        label: string;
    };
}

export interface FTMSchemaDefinition {
    name: string;
    label: string;
    plural: string;
    description: string;
    extends: string[];
    abstract?: boolean;
    matchable?: boolean;
    generated?: boolean;
    featured: string[];
    required: string[];
    caption: string[];
    properties: Record<string, FTMPropertyDefinition>;
    color?: string;
}

export interface ResolvedFTMSchema extends FTMSchemaDefinition {
    /** All properties including inherited ones */
    allProperties: Record<string, FTMPropertyDefinition>;
    /** Properties that should be shown by default (required + featured) */
    defaultProperties: string[];
    /** Optional properties (all others) */
    optionalProperties: string[];
}

// Base schemas that other schemas extend from
const BASE_SCHEMAS: Record<string, Partial<FTMSchemaDefinition>> = {
    Thing: {
        name: 'Thing',
        label: 'Thing',
        plural: 'Things',
        description: 'The most basic type of entity. All other types extend from this.',
        extends: [],
        featured: ['name'],
        required: [],
        caption: ['name'],
        properties: {
            name: { label: 'Name', type: 'name', description: 'A name or title' },
            description: { label: 'Description', type: 'text' },
            country: { label: 'Country', type: 'country' },
            alias: { label: 'Alias', type: 'name' },
            notes: { label: 'Notes', type: 'text' },
            sourceUrl: { label: 'Source URL', type: 'url', matchable: false },
            wikidataId: { label: 'Wikidata ID', type: 'identifier' },
            keywords: { label: 'Keywords' },
            topics: { label: 'Topics' },
            address: { label: 'Address', type: 'address' },
        }
    },
    Interval: {
        name: 'Interval',
        label: 'Interval',
        plural: 'Intervals',
        description: 'An object which is bounded in time.',
        extends: [],
        abstract: true,
        featured: [],
        required: [],
        caption: [],
        properties: {
            startDate: { label: 'Start date', type: 'date' },
            endDate: { label: 'End date', type: 'date' },
            date: { label: 'Date', type: 'date' },
            summary: { label: 'Summary', type: 'text' },
            description: { label: 'Description', type: 'text' },
            sourceUrl: { label: 'Source link', type: 'url', matchable: false },
            modifiedAt: { label: 'Modified on', type: 'date' },
        }
    },
    Value: {
        name: 'Value',
        label: 'Value',
        plural: 'Values',
        description: 'A monetary value with amount and currency.',
        extends: [],
        abstract: true,
        featured: ['amount', 'currency'],
        required: [],
        caption: [],
        properties: {
            amount: { label: 'Amount', type: 'number' },
            amountUsd: { label: 'Amount (USD)', type: 'number' },
            currency: { label: 'Currency' },
        }
    },
    Analyzable: {
        name: 'Analyzable',
        label: 'Analyzable',
        plural: 'Analyzables',
        description: 'An entity suitable for being processed via named-entity recognition.',
        extends: [],
        abstract: true,
        featured: [],
        required: [],
        caption: [],
        properties: {
            detectedLanguage: { label: 'Detected language', type: 'language', hidden: true },
            detectedCountry: { label: 'Detected country', type: 'country', hidden: true },
        }
    }
};

// Entity schemas - the main entity types used in the plugin
const ENTITY_SCHEMAS: Record<string, Partial<FTMSchemaDefinition>> = {
    Person: {
        name: 'Person',
        label: 'Person',
        plural: 'People',
        description: 'A natural person, alive or dead.',
        extends: ['LegalEntity'],
        matchable: true,
        featured: ['name', 'nationality', 'birthDate', 'country'],
        required: ['name'],
        caption: ['name', 'firstName', 'lastName'],
        properties: {
            firstName: { label: 'First name', type: 'name' },
            lastName: { label: 'Last name', type: 'name' },
            fatherName: { label: 'Father name', type: 'name' },
            motherName: { label: 'Mother name', type: 'name' },
            birthDate: { label: 'Birth date', type: 'date' },
            birthPlace: { label: 'Place of birth', type: 'address' },
            deathDate: { label: 'Death date', type: 'date' },
            nationality: { label: 'Nationality', type: 'country' },
            gender: { label: 'Gender' },
            title: { label: 'Title' },
            religion: { label: 'Religion' },
            ethnicity: { label: 'Ethnicity' },
            political: { label: 'Political affiliation' },
            position: { label: 'Position' },
            education: { label: 'Education' },
            passportNumber: { label: 'Passport number', type: 'identifier' },
            idNumber: { label: 'ID number', type: 'identifier' },
        },
        color: '#4CAF50'
    },
    LegalEntity: {
        name: 'LegalEntity',
        label: 'Legal entity',
        plural: 'Legal entities',
        description: 'Any party to legal proceedings, such as asset ownership, corporate governance or social interactions.',
        extends: ['Thing'],
        matchable: true,
        featured: ['name', 'country', 'legalForm', 'status'],
        required: ['name'],
        caption: ['name', 'email', 'phone', 'registrationNumber'],
        properties: {
            email: { label: 'E-Mail', type: 'email' },
            phone: { label: 'Phone', type: 'phone', maxLength: 32 },
            website: { label: 'Website', type: 'url' },
            legalForm: { label: 'Legal form', matchable: false },
            incorporationDate: { label: 'Incorporation date', type: 'date' },
            dissolutionDate: { label: 'Dissolution date', type: 'date' },
            taxStatus: { label: 'Tax status', matchable: false },
            status: { label: 'Status', matchable: false },
            sector: { label: 'Sector', matchable: false },
            classification: { label: 'Classification', matchable: false },
            registrationNumber: { label: 'Registration number', type: 'identifier' },
            idNumber: { label: 'ID Number', type: 'identifier' },
            taxNumber: { label: 'Tax Number', type: 'identifier' },
            jurisdiction: { label: 'Jurisdiction', type: 'country' },
            mainCountry: { label: 'Country of origin', type: 'country' },
        },
        color: '#607D8B'
    },
    Organization: {
        name: 'Organization',
        label: 'Organization',
        plural: 'Organizations',
        description: 'Any type of incorporated entity that cannot be owned by another.',
        extends: ['LegalEntity'],
        matchable: true,
        featured: ['name', 'country', 'legalForm', 'status'],
        required: ['name'],
        caption: ['name'],
        properties: {
            cageCode: { label: 'CAGE', type: 'identifier', maxLength: 16 },
            permId: { label: 'PermID', type: 'identifier', maxLength: 16 },
        },
        color: '#795548'
    },
    Company: {
        name: 'Company',
        label: 'Company',
        plural: 'Companies',
        description: 'A legal entity representing a commercial business.',
        extends: ['Organization'],
        matchable: true,
        featured: ['name', 'jurisdiction', 'registrationNumber', 'incorporationDate'],
        required: ['name'],
        caption: ['name', 'registrationNumber'],
        properties: {
            voenCode: { label: 'VOEN', type: 'identifier' },
            coatoCode: { label: 'COATO', type: 'identifier' },
            irsCode: { label: 'IRS Employer ID', type: 'identifier' },
            ipoCode: { label: 'IPO', type: 'identifier' },
        },
        color: '#037d9e'
    },
    Event: {
        name: 'Event',
        label: 'Event',
        plural: 'Events',
        description: 'An occurrence at a specific time and place.',
        extends: ['Interval', 'Thing'],
        matchable: false,
        featured: ['name', 'summary', 'date', 'location', 'add_to_timeline'],
        required: ['name'],
        caption: ['name', 'summary', 'date'],
        properties: {
            location: { label: 'Location', type: 'address' },
            country: { label: 'Country', type: 'country' },
            latitude: { label: 'Latitude', type: 'number' },
            longitude: { label: 'Longitude', type: 'number' },
            important: { label: 'Important' },
            add_to_timeline: { label: 'Add to Timeline', type: 'boolean' },
        },
        color: '#F22416'
    },
    Address: {
        name: 'Address',
        label: 'Address',
        plural: 'Addresses',
        description: 'A location associated with an entity.',
        extends: ['Thing'],
        matchable: true,
        featured: ['full', 'city', 'street', 'country', 'latitude', 'longitude'],
        required: [],
        caption: ['full', 'summary', 'city'],
        properties: {
            full: { label: 'Full address', type: 'address' },
            remarks: { label: 'Remarks' },
            postOfficeBox: { label: 'PO Box' },
            street: { label: 'Street address' },
            street2: { label: 'Street address (ctd.)' },
            city: { label: 'City' },
            postalCode: { label: 'Postal code', maxLength: 16 },
            region: { label: 'Region' },
            state: { label: 'State' },
            latitude: { label: 'Latitude', type: 'number' },
            longitude: { label: 'Longitude', type: 'number' },
            country: { label: 'Country', type: 'country' },
        },
        color: '#FF5722'
    },
    Vehicle: {
        name: 'Vehicle',
        label: 'Vehicle',
        plural: 'Vehicles',
        description: 'A vehicle such as a car, truck, or motorcycle.',
        extends: ['Thing'],
        matchable: false,
        featured: ['type', 'name', 'registrationNumber', 'country'],
        required: [],
        caption: ['name', 'registrationNumber'],
        properties: {
            registrationNumber: { label: 'Registration number', type: 'identifier' },
            type: { label: 'Type' },
            model: { label: 'Model' },
            buildDate: { label: 'Build Date', type: 'date' },
            registrationDate: { label: 'Registration Date', type: 'date' },
        },
        color: '#6c5952'
    },
    BankAccount: {
        name: 'BankAccount',
        label: 'Bank Account',
        plural: 'Bank Accounts',
        description: 'A bank account held at a financial institution.',
        extends: ['Thing'],
        matchable: true,
        featured: ['bankName', 'iban', 'accountNumber'],
        required: [],
        caption: ['bankName', 'iban', 'accountNumber'],
        properties: {
            bankName: { label: 'Bank name' },
            iban: { label: 'IBAN', type: 'iban' },
            accountNumber: { label: 'Account number', type: 'identifier' },
            bic: { label: 'BIC/SWIFT', type: 'identifier' },
            balance: { label: 'Balance', type: 'number' },
            currency: { label: 'Currency' },
        },
        color: '#2E7D32'
    },
    CryptoWallet: {
        name: 'CryptoWallet',
        label: 'Crypto Wallet',
        plural: 'Crypto Wallets',
        description: 'A cryptocurrency wallet address.',
        extends: ['Thing'],
        matchable: true,
        featured: ['publicKey', 'currency'],
        required: ['publicKey'],
        caption: ['publicKey'],
        properties: {
            publicKey: { label: 'Public key/Address', type: 'identifier' },
            currency: { label: 'Currency' },
            balance: { label: 'Balance', type: 'number' },
        },
        color: '#FF9800'
    },
    UserAccount: {
        name: 'UserAccount',
        label: 'User Account',
        plural: 'User Accounts',
        description: 'A user account on a platform or service.',
        extends: ['Thing'],
        matchable: true,
        featured: ['userName', 'platform', 'url'],
        required: ['userName'],
        caption: ['userName', 'platform'],
        properties: {
            userName: { label: 'Username' },
            platform: { label: 'Platform' },
            url: { label: 'Profile URL', type: 'url' },
            email: { label: 'Email', type: 'email' },
            phone: { label: 'Phone', type: 'phone' },
        },
        color: '#21B57D'
    },
    Document: {
        name: 'Document',
        label: 'Document',
        plural: 'Documents',
        description: 'A document or file.',
        extends: ['Thing'],
        matchable: false,
        featured: ['title', 'date', 'mimeType'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {
            title: { label: 'Title' },
            fileName: { label: 'File name' },
            mimeType: { label: 'MIME type' },
            fileSize: { label: 'File size', type: 'number' },
            date: { label: 'Date', type: 'date' },
            author: { label: 'Author' },
        },
        color: '#9C27B0'
    },
    RealEstate: {
        name: 'RealEstate',
        label: 'Real Estate',
        plural: 'Real Estate',
        description: 'A piece of real estate property.',
        extends: ['Thing'],
        matchable: false,
        featured: ['name', 'address', 'country'],
        required: [],
        caption: ['name', 'address'],
        properties: {
            registrationNumber: { label: 'Registration number', type: 'identifier' },
            area: { label: 'Area' },
            areaUnit: { label: 'Area unit' },
            buildDate: { label: 'Build date', type: 'date' },
            propertyType: { label: 'Property type' },
        },
        color: '#8D6E63'
    },
    Sanction: {
        name: 'Sanction',
        label: 'Sanction',
        plural: 'Sanctions',
        description: 'A sanction or restriction placed on an entity.',
        extends: ['Interval'],
        matchable: false,
        featured: ['program', 'authority', 'reason'],
        required: [],
        caption: ['program', 'authority'],
        properties: {
            program: { label: 'Program' },
            authority: { label: 'Authority' },
            reason: { label: 'Reason' },
            listingDate: { label: 'Listing date', type: 'date' },
            provisions: { label: 'Provisions' },
        },
        color: '#D32F2F'
    },
    Passport: {
        name: 'Passport',
        label: 'Passport',
        plural: 'Passports',
        description: 'A passport or travel document.',
        extends: ['Interval', 'Thing'],
        matchable: true,
        featured: ['number', 'country', 'type'],
        required: ['number'],
        caption: ['number', 'country'],
        properties: {
            number: { label: 'Number', type: 'identifier' },
            type: { label: 'Type' },
            country: { label: 'Country', type: 'country' },
            issueDate: { label: 'Issue date', type: 'date' },
            expiryDate: { label: 'Expiry date', type: 'date' },
        },
        color: '#1565C0'
    },
    // Relationship schemas
    Ownership: {
        name: 'Ownership',
        label: 'Ownership',
        plural: 'Ownerships',
        description: 'An ownership relationship between entities.',
        extends: ['Interval'],
        matchable: false,
        featured: ['owner', 'asset', 'percentage'],
        required: [],
        caption: ['owner', 'asset'],
        properties: {
            percentage: { label: 'Percentage', type: 'number' },
            sharesCount: { label: 'Shares count', type: 'number' },
            sharesValue: { label: 'Shares value', type: 'number' },
            sharesCurrency: { label: 'Shares currency' },
        },
        color: '#546E7A'
    },
    Employment: {
        name: 'Employment',
        label: 'Employment',
        plural: 'Employments',
        description: 'An employment relationship.',
        extends: ['Interval'],
        matchable: false,
        featured: ['employee', 'employer', 'role'],
        required: [],
        caption: ['employee', 'employer', 'role'],
        properties: {
            role: { label: 'Role' },
            title: { label: 'Title' },
            salary: { label: 'Salary', type: 'number' },
            salaryCurrency: { label: 'Salary currency' },
        },
        color: '#00897B'
    },
    Directorship: {
        name: 'Directorship',
        label: 'Directorship',
        plural: 'Directorships',
        description: 'A directorship or board membership.',
        extends: ['Interval'],
        matchable: false,
        featured: ['director', 'organization', 'role'],
        required: [],
        caption: ['director', 'organization', 'role'],
        properties: {
            role: { label: 'Role' },
            secretary: { label: 'Secretary' },
        },
        color: '#5E35B1'
    },
    // Additional FTM schemas from ftm/ folder
    Airplane: {
        name: 'Airplane',
        label: 'Airplane',
        plural: 'Airplanes',
        description: 'An airplane, helicopter or other flying vehicle.',
        extends: ['Vehicle'],
        matchable: true,
        featured: ['type', 'registrationNumber', 'country', 'name'],
        required: [],
        caption: ['name', 'registrationNumber'],
        properties: {
            serialNumber: { label: 'Serial Number', type: 'identifier' },
            icaoCode: { label: 'ICAO aircraft type designator', type: 'identifier', maxLength: 16 },
            manufacturer: { label: 'Manufacturer' },
        },
        color: '#5C6BC0'
    },
    Vessel: {
        name: 'Vessel',
        label: 'Vessel',
        plural: 'Vessels',
        description: 'A boat or ship. Typically flying some sort of national flag.',
        extends: ['Vehicle'],
        matchable: true,
        featured: ['name', 'imoNumber', 'type', 'flag'],
        required: ['name'],
        caption: ['name', 'imoNumber'],
        properties: {
            imoNumber: { label: 'IMO Number', type: 'identifier', maxLength: 16 },
            crsNumber: { label: 'CRS Number', type: 'identifier' },
            flag: { label: 'Flag', type: 'country' },
            registrationPort: { label: 'Port of Registration' },
            navigationArea: { label: 'Navigation Area' },
            tonnage: { label: 'Tonnage', type: 'number' },
            grossRegisteredTonnage: { label: 'Gross Registered Tonnage', type: 'number' },
            callSign: { label: 'Call Sign', type: 'identifier' },
            mmsi: { label: 'MMSI', type: 'identifier', maxLength: 16 },
        },
        color: '#0288D1'
    },
    PublicBody: {
        name: 'PublicBody',
        label: 'Public Body',
        plural: 'Public Bodies',
        description: 'A public body, such as a ministry, department or state company.',
        extends: ['Organization'],
        matchable: true,
        featured: ['name', 'country', 'legalForm', 'status'],
        required: ['name'],
        caption: ['name'],
        properties: {},
        color: '#7B1FA2'
    },
    Asset: {
        name: 'Asset',
        label: 'Asset',
        plural: 'Assets',
        description: 'A piece of property which can be owned and assigned a monetary value.',
        extends: ['Thing', 'Value'],
        matchable: false,
        featured: ['name', 'amount'],
        required: [],
        caption: ['name'],
        properties: {},
        color: '#FFA000'
    },
    Security: {
        name: 'Security',
        label: 'Security',
        plural: 'Securities',
        description: 'A tradeable financial asset.',
        extends: ['Asset'],
        matchable: true,
        featured: ['isin', 'name', 'country'],
        required: [],
        caption: ['name', 'isin', 'registrationNumber'],
        properties: {
            isin: { label: 'ISIN', type: 'identifier', maxLength: 16 },
            registrationNumber: { label: 'Registration number', type: 'identifier' },
            ticker: { label: 'Stock ticker symbol', type: 'identifier' },
            figiCode: { label: 'Financial Instrument Global Identifier', type: 'identifier', maxLength: 16 },
            issueDate: { label: 'Date issued', type: 'date' },
            maturityDate: { label: 'Maturity date', type: 'date' },
            type: { label: 'Type' },
            classification: { label: 'Classification' },
        },
        color: '#00796B'
    },
    Payment: {
        name: 'Payment',
        label: 'Payment',
        plural: 'Payments',
        description: 'A monetary payment between two parties.',
        extends: ['Interval', 'Value'],
        matchable: false,
        featured: ['date', 'amount', 'purpose'],
        required: [],
        caption: ['amount'],
        properties: {
            sequenceNumber: { label: 'Sequence number' },
            transactionNumber: { label: 'Transaction number' },
            purpose: { label: 'Payment purpose', type: 'text' },
            programme: { label: 'Payment programme' },
        },
        color: '#388E3C'
    },
    Folder: {
        name: 'Folder',
        label: 'Folder',
        plural: 'Folders',
        description: 'A folder or directory containing documents.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title'],
        required: [],
        caption: ['fileName', 'title'],
        properties: {},
        color: '#8D6E63'
    },
    PlainText: {
        name: 'PlainText',
        label: 'Text File',
        plural: 'Text Files',
        description: 'Text files, like .txt or source code.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'fileName', 'mimeType'],
        required: [],
        caption: ['fileName', 'title'],
        properties: {
            bodyText: { label: 'Text', type: 'text', hidden: true },
        },
        color: '#78909C'
    },
    HyperText: {
        name: 'HyperText',
        label: 'Web Page',
        plural: 'Web Pages',
        description: 'An HTML document or web page.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'fileName', 'mimeType'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {
            bodyHtml: { label: 'HTML', type: 'html', hidden: true },
        },
        color: '#26A69A'
    },
    Email: {
        name: 'Email',
        label: 'E-Mail',
        plural: 'E-Mails',
        description: 'An internet mail message with subject, sender, and recipients.',
        extends: ['Folder', 'PlainText', 'HyperText'],
        matchable: false,
        generated: true,
        featured: ['subject', 'date', 'from'],
        required: [],
        caption: ['subject', 'threadTopic', 'title', 'name', 'fileName'],
        properties: {
            subject: { label: 'Subject' },
            threadTopic: { label: 'Thread topic' },
            sender: { label: 'Sender' },
            from: { label: 'From' },
            to: { label: 'To' },
            cc: { label: 'CC' },
            bcc: { label: 'BCC' },
        },
        color: '#2196F3'
    },
    Message: {
        name: 'Message',
        label: 'Message',
        plural: 'Messages',
        description: 'A message or communication between parties.',
        extends: ['Interval', 'Folder', 'PlainText', 'HyperText'],
        matchable: false,
        generated: true,
        featured: ['subject', 'date'],
        required: [],
        caption: ['subject', 'title', 'threadTopic', 'fileName'],
        properties: {
            subject: { label: 'Subject' },
            threadTopic: { label: 'Thread topic' },
        },
        color: '#7E57C2'
    },
    Contract: {
        name: 'Contract',
        label: 'Contract',
        plural: 'Contracts',
        description: 'A contract or contract lot issued by an authority.',
        extends: ['Asset'],
        matchable: false,
        featured: ['title', 'amount', 'contractDate'],
        required: ['title'],
        caption: ['title', 'name', 'procedureNumber'],
        properties: {
            title: { label: 'Title' },
            type: { label: 'Type' },
            contractDate: { label: 'Contract date', type: 'date' },
            procedureNumber: { label: 'Procedure number' },
            procedure: { label: 'Contract procedure' },
            status: { label: 'Status' },
            method: { label: 'Procurement method' },
            criteria: { label: 'Contract award criteria' },
            classification: { label: 'Classification' },
        },
        color: '#5D4037'
    },
    Project: {
        name: 'Project',
        label: 'Project',
        plural: 'Projects',
        description: 'An activity carried out by a group of participants.',
        extends: ['Interval', 'Thing', 'Value'],
        matchable: false,
        featured: ['name', 'projectId', 'startDate'],
        required: [],
        caption: ['name', 'projectId'],
        properties: {
            projectId: { label: 'Project ID', type: 'identifier' },
            status: { label: 'Status' },
            phase: { label: 'Phase' },
            goal: { label: 'Project goal' },
        },
        color: '#00ACC1'
    },
    CourtCase: {
        name: 'CourtCase',
        label: 'Court Case',
        plural: 'Court Cases',
        description: 'A legal case in a court of law.',
        extends: ['Thing'],
        matchable: false,
        featured: ['name', 'fileDate', 'caseNumber'],
        required: ['name'],
        caption: ['name', 'caseNumber'],
        properties: {
            category: { label: 'Category' },
            type: { label: 'Type' },
            status: { label: 'Status' },
            caseNumber: { label: 'Case number', type: 'identifier' },
            court: { label: 'Court' },
            fileDate: { label: 'File date', type: 'date' },
            closeDate: { label: 'Close date', type: 'date' },
        },
        color: '#6D4C41'
    },
    Family: {
        name: 'Family',
        label: 'Family',
        plural: 'Family Members',
        description: 'Family relationship between two people.',
        extends: ['Interval'],
        matchable: false,
        featured: ['relationship'],
        required: [],
        caption: ['relationship'],
        properties: {
            relationship: { label: 'Relationship' },
        },
        color: '#E91E63'
    },
    Membership: {
        name: 'Membership',
        label: 'Membership',
        plural: 'Memberships',
        description: 'A membership in an organization.',
        extends: ['Interval'],
        matchable: false,
        featured: ['role'],
        required: [],
        caption: ['role'],
        properties: {
            role: { label: 'Role' },
            status: { label: 'Status' },
        },
        color: '#9C27B0'
    },
    Associate: {
        name: 'Associate',
        label: 'Associate',
        plural: 'Associates',
        description: 'An association between two entities.',
        extends: ['Interval'],
        matchable: false,
        featured: ['relationship'],
        required: [],
        caption: ['relationship'],
        properties: {
            relationship: { label: 'Relationship' },
        },
        color: '#673AB7'
    },
    Representation: {
        name: 'Representation',
        label: 'Representation',
        plural: 'Representations',
        description: 'A legal or formal representation relationship.',
        extends: ['Interval'],
        matchable: false,
        featured: ['role'],
        required: [],
        caption: ['role'],
        properties: {
            role: { label: 'Role' },
        },
        color: '#3F51B5'
    },
    Identification: {
        name: 'Identification',
        label: 'Identification',
        plural: 'Identifications',
        description: 'An identification document or number.',
        extends: ['Interval', 'Thing'],
        matchable: true,
        featured: ['number', 'type', 'country'],
        required: ['number'],
        caption: ['number', 'type'],
        properties: {
            number: { label: 'Number', type: 'identifier' },
            type: { label: 'Type' },
            country: { label: 'Country', type: 'country' },
            issueDate: { label: 'Issue date', type: 'date' },
            expiryDate: { label: 'Expiry date', type: 'date' },
        },
        color: '#1976D2'
    },
    License: {
        name: 'License',
        label: 'License',
        plural: 'Licenses',
        description: 'A license or permit.',
        extends: ['Interval', 'Thing'],
        matchable: false,
        featured: ['number', 'type', 'authority'],
        required: [],
        caption: ['number', 'type'],
        properties: {
            number: { label: 'Number', type: 'identifier' },
            type: { label: 'Type' },
            authority: { label: 'Authority' },
            issueDate: { label: 'Issue date', type: 'date' },
            expiryDate: { label: 'Expiry date', type: 'date' },
        },
        color: '#0097A7'
    },
    Debt: {
        name: 'Debt',
        label: 'Debt',
        plural: 'Debts',
        description: 'A debt or liability.',
        extends: ['Interval', 'Value'],
        matchable: false,
        featured: ['amount', 'currency', 'date'],
        required: [],
        caption: ['amount'],
        properties: {
            status: { label: 'Status' },
            type: { label: 'Type' },
        },
        color: '#C62828'
    },
    Interest: {
        name: 'Interest',
        label: 'Interest',
        plural: 'Interests',
        description: 'An interest or stake in an entity.',
        extends: ['Interval'],
        matchable: false,
        featured: ['percentage', 'type'],
        required: [],
        caption: ['percentage', 'type'],
        properties: {
            percentage: { label: 'Percentage', type: 'number' },
            type: { label: 'Type' },
            status: { label: 'Status' },
        },
        color: '#AD1457'
    },
    Occupancy: {
        name: 'Occupancy',
        label: 'Occupancy',
        plural: 'Occupancies',
        description: 'An occupancy of a position or role.',
        extends: ['Interval'],
        matchable: false,
        featured: ['role', 'status'],
        required: [],
        caption: ['role'],
        properties: {
            role: { label: 'Role' },
            status: { label: 'Status' },
        },
        color: '#6A1B9A'
    },
    Position: {
        name: 'Position',
        label: 'Position',
        plural: 'Positions',
        description: 'A position or role in an organization.',
        extends: ['Thing'],
        matchable: false,
        featured: ['name', 'country'],
        required: ['name'],
        caption: ['name'],
        properties: {
            subnationalArea: { label: 'Subnational area' },
        },
        color: '#4527A0'
    },
    Trip: {
        name: 'Trip',
        label: 'Trip',
        plural: 'Trips',
        description: 'A journey or trip.',
        extends: ['Interval', 'Thing'],
        matchable: false,
        featured: ['name', 'startDate', 'endDate'],
        required: [],
        caption: ['name'],
        properties: {
            origin: { label: 'Origin' },
            destination: { label: 'Destination' },
            purpose: { label: 'Purpose' },
        },
        color: '#00838F'
    },
    Call: {
        name: 'Call',
        label: 'Call',
        plural: 'Calls',
        description: 'A phone call or communication.',
        extends: ['Interval'],
        matchable: false,
        featured: ['date', 'duration'],
        required: [],
        caption: ['date'],
        properties: {
            duration: { label: 'Duration' },
            type: { label: 'Type' },
        },
        color: '#00695C'
    },
    Image: {
        name: 'Image',
        label: 'Image',
        plural: 'Images',
        description: 'An image file.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'fileName'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {
            width: { label: 'Width', type: 'number' },
            height: { label: 'Height', type: 'number' },
        },
        color: '#F4511E'
    },
    Video: {
        name: 'Video',
        label: 'Video',
        plural: 'Videos',
        description: 'A video file.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'fileName'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {
            duration: { label: 'Duration' },
        },
        color: '#D81B60'
    },
    Audio: {
        name: 'Audio',
        label: 'Audio',
        plural: 'Audio Files',
        description: 'An audio file.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'fileName'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {
            duration: { label: 'Duration' },
        },
        color: '#8E24AA'
    },
    Article: {
        name: 'Article',
        label: 'Article',
        plural: 'Articles',
        description: 'A news article or publication.',
        extends: ['Document'],
        matchable: false,
        featured: ['title', 'date', 'author'],
        required: [],
        caption: ['title'],
        properties: {
            author: { label: 'Author' },
            publisher: { label: 'Publisher' },
            publishedAt: { label: 'Published at', type: 'date' },
        },
        color: '#5E35B1'
    },
    Note: {
        name: 'Note',
        label: 'Note',
        plural: 'Notes',
        description: 'A note or annotation.',
        extends: ['PlainText'],
        matchable: false,
        featured: ['title', 'date'],
        required: [],
        caption: ['title'],
        properties: {},
        color: '#FDD835'
    },
    Post: {
        name: 'Post',
        label: 'Post',
        plural: 'Posts',
        description: 'A social media post or message.',
        extends: ['Document'],
        matchable: false,
        featured: ['title', 'date'],
        required: [],
        caption: ['title'],
        properties: {
            platform: { label: 'Platform' },
            url: { label: 'URL', type: 'url' },
        },
        color: '#1E88E5'
    },
    Mention: {
        name: 'Mention',
        label: 'Mention',
        plural: 'Mentions',
        description: 'A mention of an entity in a document.',
        extends: ['Interval'],
        matchable: false,
        featured: ['name'],
        required: [],
        caption: ['name'],
        properties: {
            name: { label: 'Name' },
            detectedLanguage: { label: 'Detected language' },
        },
        color: '#43A047'
    },
    Assessment: {
        name: 'Assessment',
        label: 'Assessment',
        plural: 'Assessments',
        description: 'An assessment or evaluation.',
        extends: ['Interval', 'Thing'],
        matchable: false,
        featured: ['name', 'date'],
        required: [],
        caption: ['name'],
        properties: {
            type: { label: 'Type' },
            status: { label: 'Status' },
            result: { label: 'Result' },
        },
        color: '#FB8C00'
    },
    TaxRoll: {
        name: 'TaxRoll',
        label: 'Tax Roll',
        plural: 'Tax Rolls',
        description: 'A tax roll or tax record.',
        extends: ['Interval', 'Value'],
        matchable: false,
        featured: ['amount', 'date'],
        required: [],
        caption: ['amount'],
        properties: {
            type: { label: 'Type' },
            status: { label: 'Status' },
        },
        color: '#7CB342'
    },
    Succession: {
        name: 'Succession',
        label: 'Succession',
        plural: 'Successions',
        description: 'A succession or inheritance relationship.',
        extends: ['Interval'],
        matchable: false,
        featured: ['date'],
        required: [],
        caption: ['date'],
        properties: {
            type: { label: 'Type' },
        },
        color: '#8D6E63'
    },
    Similar: {
        name: 'Similar',
        label: 'Similar',
        plural: 'Similarities',
        description: 'A similarity relationship between entities.',
        extends: ['Interval'],
        matchable: false,
        featured: ['score'],
        required: [],
        caption: ['score'],
        properties: {
            score: { label: 'Score', type: 'number' },
        },
        color: '#78909C'
    },
    UnknownLink: {
        name: 'UnknownLink',
        label: 'Unknown Link',
        plural: 'Unknown Links',
        description: 'An unknown or unclassified relationship.',
        extends: ['Interval'],
        matchable: false,
        featured: ['description'],
        required: [],
        caption: ['description'],
        properties: {
            description: { label: 'Description' },
        },
        color: '#90A4AE'
    },
    Table: {
        name: 'Table',
        label: 'Table',
        plural: 'Tables',
        description: 'A data table.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {},
        color: '#26A69A'
    },
    Workbook: {
        name: 'Workbook',
        label: 'Workbook',
        plural: 'Workbooks',
        description: 'A spreadsheet workbook.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {},
        color: '#66BB6A'
    },
    Package: {
        name: 'Package',
        label: 'Package',
        plural: 'Packages',
        description: 'A package or archive file.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {},
        color: '#8D6E63'
    },
    Page: {
        name: 'Page',
        label: 'Page',
        plural: 'Pages',
        description: 'A page in a document.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title', 'index'],
        required: [],
        caption: ['title', 'index'],
        properties: {
            index: { label: 'Page number', type: 'number' },
        },
        color: '#BDBDBD'
    },
    Pages: {
        name: 'Pages',
        label: 'Pages',
        plural: 'Pages',
        description: 'A collection of pages.',
        extends: ['Document'],
        matchable: false,
        generated: true,
        featured: ['title'],
        required: [],
        caption: ['title', 'fileName'],
        properties: {},
        color: '#9E9E9E'
    },
    EconomicActivity: {
        name: 'EconomicActivity',
        label: 'Economic Activity',
        plural: 'Economic Activities',
        description: 'An economic activity or business sector.',
        extends: ['Thing'],
        matchable: false,
        featured: ['name', 'code'],
        required: [],
        caption: ['name', 'code'],
        properties: {
            code: { label: 'Code', type: 'identifier' },
            classification: { label: 'Classification' },
        },
        color: '#558B2F'
    },
    CallForTenders: {
        name: 'CallForTenders',
        label: 'Call for Tenders',
        plural: 'Calls for Tenders',
        description: 'A call for tenders or procurement notice.',
        extends: ['Asset'],
        matchable: false,
        featured: ['title', 'amount', 'date'],
        required: [],
        caption: ['title'],
        properties: {
            title: { label: 'Title' },
            deadline: { label: 'Deadline', type: 'date' },
            status: { label: 'Status' },
        },
        color: '#0277BD'
    },
    ContractAward: {
        name: 'ContractAward',
        label: 'Contract Award',
        plural: 'Contract Awards',
        description: 'An award of a contract to a supplier.',
        extends: ['Interval', 'Value'],
        matchable: false,
        featured: ['amount', 'date'],
        required: [],
        caption: ['amount'],
        properties: {
            lotNumber: { label: 'Lot number' },
        },
        color: '#00897B'
    },
    CourtCaseParty: {
        name: 'CourtCaseParty',
        label: 'Court Case Party',
        plural: 'Court Case Parties',
        description: 'A party to a court case.',
        extends: ['Interval'],
        matchable: false,
        featured: ['role'],
        required: [],
        caption: ['role'],
        properties: {
            role: { label: 'Role' },
        },
        color: '#5D4037'
    },
    ProjectParticipant: {
        name: 'ProjectParticipant',
        label: 'Project Participant',
        plural: 'Project Participants',
        description: 'A participant in a project.',
        extends: ['Interval'],
        matchable: false,
        featured: ['role'],
        required: [],
        caption: ['role'],
        properties: {
            role: { label: 'Role' },
        },
        color: '#0288D1'
    },
};

// Combine all schemas
const ALL_SCHEMAS: Record<string, Partial<FTMSchemaDefinition>> = {
    ...BASE_SCHEMAS,
    ...ENTITY_SCHEMAS,
};

/**
 * FTM Schema Service - provides resolved FTM schemas with inheritance.
 */
class FTMSchemaServiceClass {
    private resolvedSchemas: Map<string, ResolvedFTMSchema> = new Map();
    private initialized: boolean = false;

    /**
     * Initialize the schema service by resolving all schemas.
     */
    initialize(): void {
        if (this.initialized) return;

        for (const schemaName of Object.keys(ALL_SCHEMAS)) {
            this.resolveSchema(schemaName);
        }
        this.initialized = true;
    }

    /**
     * Resolve a schema by name, including all inherited properties.
     */
    private resolveSchema(schemaName: string): ResolvedFTMSchema | null {
        // Check cache first
        if (this.resolvedSchemas.has(schemaName)) {
            return this.resolvedSchemas.get(schemaName)!;
        }

        const schema = ALL_SCHEMAS[schemaName];
        if (!schema) {
            console.warn(`[FTMSchemaService] Schema not found: ${schemaName}`);
            return null;
        }

        // Start with empty properties
        let allProperties: Record<string, FTMPropertyDefinition> = {};

        // Resolve parent schemas first and merge their properties
        if (schema.extends && schema.extends.length > 0) {
            for (const parentName of schema.extends) {
                const parentSchema = this.resolveSchema(parentName);
                if (parentSchema) {
                    allProperties = { ...allProperties, ...parentSchema.allProperties };
                }
            }
        }

        // Add this schema's own properties (override inherited ones)
        if (schema.properties) {
            allProperties = { ...allProperties, ...schema.properties };
        }

        // Determine default and optional properties
        const required = schema.required || [];
        const featured = schema.featured || [];
        const defaultProperties = [...new Set([...required, ...featured])];

        // Optional properties are all properties not in default
        const optionalProperties = Object.keys(allProperties).filter(
            prop => !defaultProperties.includes(prop) && !allProperties[prop].hidden
        );

        const resolved: ResolvedFTMSchema = {
            name: schemaName,
            label: schema.label || schemaName,
            plural: schema.plural || schemaName + 's',
            description: schema.description || '',
            extends: schema.extends || [],
            abstract: schema.abstract,
            matchable: schema.matchable,
            generated: schema.generated,
            featured: featured,
            required: required,
            caption: schema.caption || [],
            properties: schema.properties || {},
            allProperties,
            defaultProperties,
            optionalProperties,
            color: schema.color,
        };

        this.resolvedSchemas.set(schemaName, resolved);
        return resolved;
    }

    /**
     * Get a resolved schema by name.
     */
    getSchema(schemaName: string): ResolvedFTMSchema | null {
        this.initialize();
        return this.resolvedSchemas.get(schemaName) || null;
    }

    /**
     * Get all available entity schemas (non-abstract).
     */
    getEntitySchemas(): ResolvedFTMSchema[] {
        this.initialize();
        return Array.from(this.resolvedSchemas.values()).filter(
            schema => !schema.abstract
        );
    }

    /**
     * Get all available interval/relationship schemas (extends Interval, non-abstract).
     * These represent connections/relationships between entities in the FTM model.
     */
    getIntervalSchemas(): ResolvedFTMSchema[] {
        this.initialize();
        return Array.from(this.resolvedSchemas.values()).filter(
            schema => !schema.abstract && this.extendsInterval(schema)
        );
    }

    /**
     * Check if a schema extends from Interval (directly or indirectly).
     */
    private extendsInterval(schema: ResolvedFTMSchema): boolean {
        if (schema.name === 'Interval') return false; // Interval itself is abstract
        if (schema.extends.includes('Interval')) return true;

        // Check parent schemas recursively
        for (const parentName of schema.extends) {
            const parentSchema = this.getSchema(parentName);
            if (parentSchema && this.extendsInterval(parentSchema)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all schema names.
     */
    getSchemaNames(): string[] {
        this.initialize();
        return Array.from(this.resolvedSchemas.keys());
    }

    /**
     * Get entity schema names (non-abstract, suitable for entity creation).
     */
    getEntitySchemaNames(): string[] {
        return this.getEntitySchemas().map(s => s.name);
    }

    /**
     * Check if a schema exists.
     */
    hasSchema(schemaName: string): boolean {
        this.initialize();
        return this.resolvedSchemas.has(schemaName);
    }

    /**
     * Get the label field for a schema (first caption field or 'name').
     */
    getLabelField(schemaName: string): string {
        const schema = this.getSchema(schemaName);
        if (!schema) return 'name';

        // Use first caption field that exists in properties
        for (const field of schema.caption) {
            if (schema.allProperties[field]) {
                return field;
            }
        }
        return 'name';
    }

    /**
     * Get the color for a schema.
     */
    getColor(schemaName: string): string {
        const schema = this.getSchema(schemaName);
        return schema?.color || '#607D8B';
    }

    /**
     * Get property definition for a schema.
     */
    getProperty(schemaName: string, propertyName: string): FTMPropertyDefinition | null {
        const schema = this.getSchema(schemaName);
        if (!schema) return null;
        return schema.allProperties[propertyName] || null;
    }

    /**
     * Get the label for an entity based on its schema and properties.
     */
    getEntityLabel(schemaName: string, properties: Record<string, any>): string {
        const labelField = this.getLabelField(schemaName);
        if (properties[labelField]) {
            return String(properties[labelField]);
        }

        // Fallback: try common label fields that backend might use
        const fallbackFields = ['full_name', 'name', 'title', 'address', 'label'];
        for (const field of fallbackFields) {
            if (properties[field] && typeof properties[field] === 'string' && properties[field].trim()) {
                return String(properties[field]);
            }
        }

        return schemaName;
    }
}

// Export singleton instance
export const ftmSchemaService = new FTMSchemaServiceClass();

// Export the class for testing
export { FTMSchemaServiceClass };

