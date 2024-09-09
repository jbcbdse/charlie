FROM ubuntu:22.04

# install core utilities, not project specific
RUN apt-get update
RUN apt-get install -y ca-certificates curl gnupg lsb-release
RUN apt-get install -y git locales net-tools python3 python3-pip sudo unzip vim wget zsh

# install aws cli
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
  unzip awscliv2.zip && \
  sudo ./aws/install

# Set up non-root user
ARG USERNAME=user
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
  && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
  && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
  && chmod 0440 /etc/sudoers.d/$USERNAME
USER $USERNAME
ENV PATH=${PATH}:/home/user/.local/bin

SHELL ["/bin/bash", "--login", "-c"]
ENV NVM_DIR /home/${USERNAME}/.nvm
ENV NODE_VERSION 22.6.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
  && . $NVM_DIR/nvm.sh \
  && nvm install $NODE_VERSION \
  && nvm alias default $NODE_VERSION

# configure zsh
RUN git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k
ADD .devcontainer/docker/.zshrc /home/user/.zshrc
ADD .devcontainer/docker/.p10k.zsh /home/user/.p10k.zsh
ENV SHELL /bin/zsh
