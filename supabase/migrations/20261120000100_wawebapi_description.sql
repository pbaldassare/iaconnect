-- The QR is scanned in the waWebApi panel. Here the customer pastes the instance id and the token.

update ia_connect.connector_types
set description = 'Numero già collegato su waWebApi: id istanza e token Bearer.'
where key = 'whatsapp_wawebapi';
