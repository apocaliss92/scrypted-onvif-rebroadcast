export interface RtspStreamInfo {
    name: string;
    rtspUrl: string;
    width?: number;
    height?: number;
}

export interface DeviceCapabilities {
    hasPtz: boolean;
    ptzCapabilities?: {
        pan?: boolean;
        tilt?: boolean;
        zoom?: boolean;
    };
    hasIntercom: boolean;
    hasMotionSensor: boolean;
    hasAudioSensor: boolean;
    hasObjectDetection: boolean;
}

export interface OnvifEvent {
    topic: string;
    timestamp: Date;
    source: string;
    data: Record<string, string | boolean | number>;
}

export interface OnvifServiceConfig {
    deviceName: string;
    deviceId: string;
    manufacturer: string;
    model: string;
    firmwareVersion: string;
    serialNumber: string;
    hostname: string;
    onvifIp?: string;
    /** When true, onvifIp is only used in SOAP responses, not for server binding */
    proxyMode?: boolean;
    onvifPort: number;
    streams: RtspStreamInfo[];
    username?: string;
    password?: string;
    capabilities: DeviceCapabilities;
    /** Callback to get a JPEG snapshot from the camera */
    getSnapshot?: () => Promise<Buffer>;
}
