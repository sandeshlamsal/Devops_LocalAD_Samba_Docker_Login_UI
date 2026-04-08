FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    samba \
    krb5-user \
    winbind \
    dnsutils \
    net-tools \
    && rm -rf /var/lib/apt/lists/*
# samba-tool is included in the samba package on Ubuntu 22.04

# Remove default smb.conf so provision can create a fresh one
RUN rm -f /etc/samba/smb.conf

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 389 636 445 88 53

ENTRYPOINT ["/entrypoint.sh"]
