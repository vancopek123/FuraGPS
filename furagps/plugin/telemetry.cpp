// Fura GPS telemetry bridge. SCS SDK headers: Copyright SCS Software, MIT.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <windows.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <cmath>
#include "scssdk_telemetry.h"
#include "common/scssdk_telemetry_truck_common_channels.h"
#pragma comment(lib,"ws2_32.lib")

static SOCKET sock=INVALID_SOCKET;
static sockaddr_in target{};
static scs_value_dplacement_t placement{};
static float speed=0,limit=0,fuel=0,navDistance=0,navTime=0,scale=19;
static scs_s32_t gear=0;
static bool paused=true,positionValid=false;
static ULONGLONG lastSent=0;
static const char* gameId="ets2";
#ifndef FURAGPS_UDP_PORT
#define FURAGPS_UDP_PORT 28887
#endif
static std::string destinationCity,destinationCompany;
static std::string escape(const std::string& value) {
    std::string out; for(unsigned char c:value) { if(c=='"'||c=='\\'){out+='\\';out+=c;} else if(c>=32)out+=c; } return out;
}
#include "dashboard.hpp"
static void publish(bool force=false) {
    if(sock==INVALID_SOCKET)return;
    auto now=GetTickCount64();if(!force&&now-lastSent<100)return;lastSent=now;
    char body[4096];
    double heading=fmod(360.0-placement.orientation.heading*360.0,360.0);
    if(heading<0)heading+=360;
    int n=snprintf(body,sizeof(body),"{\"x\":%.4f,\"z\":%.4f,\"heading\":%.3f,\"speed\":%.3f,\"speedLimit\":%.3f,\"fuel\":%.2f,\"gear\":%d,\"navigationDistance\":%.2f,\"navigationTime\":%.2f,\"paused\":%s,\"positionValid\":%s,\"scale\":%.2f,\"destinationCity\":\"%s\",\"destinationCompany\":\"%s\"}",
      placement.position.x,placement.position.z,heading,speed*3.6,limit*3.6,fuel,gear,navDistance,navTime,
      paused?"true":"false",positionValid?"true":"false",scale,escape(destinationCity).c_str(),escape(destinationCompany).c_str());
    if(n>0&&n<sizeof(body)){std::string json(body,n-1);json+=",\"game\":\""+std::string(gameId)+"\""+dashboard_json()+"}";if(json.size()<8000)sendto(sock,json.data(),(int)json.size(),0,(sockaddr*)&target,sizeof(target));}
    reset_acceleration_peak();
}
SCSAPI_VOID store_float(const scs_string_t name, const scs_u32_t,const scs_value_t* const v,const scs_context_t c){bool valid=v&&v->type==SCS_VALUE_TYPE_float&&std::isfinite(v->value_float.value);if(!strcmp(name,"truck.navigation.distance"))navDistanceValid=valid;if(!strcmp(name,"truck.navigation.time"))navTimeValid=valid;if(valid)*(float*)c=v->value_float.value;else *(float*)c=0;}
SCSAPI_VOID store_int(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t c){if(v)*(scs_s32_t*)c=v->value_s32.value;}
SCSAPI_VOID store_position(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t){if(v){placement=v->value_dplacement;positionValid=true;}else positionValid=false;}
SCSAPI_VOID frame(const scs_event_t,const void* const,const scs_context_t){capture_acceleration_peak();publish();}
SCSAPI_VOID pause_event(const scs_event_t event,const void* const,const scs_context_t){paused=(event==SCS_TELEMETRY_EVENT_paused);reset_acceleration_peak();publish(true);}
SCSAPI_VOID configuration(const scs_event_t,const void* const info,const scs_context_t){
    auto cfg=(const scs_telemetry_configuration_t*)info;
    if(!cfg||!cfg->id)return;
    if(!strcmp(cfg->id,"bus_job")){bus_configuration(cfg);return;}
    if(strcmp(cfg->id,"job"))return;
    destinationCity.clear();destinationCompany.clear();
    for(auto a=cfg->attributes;a&&a->name;++a){
        if(a->value.type!=SCS_VALUE_TYPE_string||!a->value.value_string.value)continue;
        if(!strcmp(a->name,"destination.city.id"))destinationCity=std::string(a->value.value_string.value).substr(0,200);
        if(!strcmp(a->name,"destination.company"))destinationCompany=std::string(a->value.value_string.value).substr(0,200);
    }
}
SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version,const scs_telemetry_init_params_t* const params){
    if(version!=SCS_TELEMETRY_VERSION_1_01 && version!=SCS_TELEMETRY_VERSION_1_00)return SCS_RESULT_unsupported;
    auto p=(const scs_telemetry_init_params_v100_t*)params;
    if(!p||!p->common.game_id||(strcmp(p->common.game_id,"eut2")&&strcmp(p->common.game_id,"ats")))return SCS_RESULT_unsupported;
    gameId=!strcmp(p->common.game_id,"ats")?"ats":"ets2";scale=!strcmp(gameId,"ats")?20:19;
    WSADATA wsa;if(WSAStartup(MAKEWORD(2,2),&wsa))return SCS_RESULT_generic_error;
    sock=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP);if(sock==INVALID_SOCKET){WSACleanup();return SCS_RESULT_generic_error;}
    u_long mode=1;ioctlsocket(sock,FIONBIO,&mode);
    target.sin_family=AF_INET;target.sin_addr.s_addr=htonl(INADDR_LOOPBACK);target.sin_port=htons(FURAGPS_UDP_PORT);
    p->register_for_event(SCS_TELEMETRY_EVENT_frame_end,frame,nullptr);
    p->register_for_event(SCS_TELEMETRY_EVENT_paused,pause_event,nullptr);
    p->register_for_event(SCS_TELEMETRY_EVENT_started,pause_event,nullptr);
    p->register_for_event(SCS_TELEMETRY_EVENT_configuration,configuration,nullptr);
    auto result=p->register_for_channel("truck.world.placement",SCS_U32_NIL,SCS_VALUE_TYPE_dplacement,SCS_TELEMETRY_CHANNEL_FLAG_no_value,store_position,nullptr);
    if(result!=SCS_RESULT_ok){closesocket(sock);sock=INVALID_SOCKET;WSACleanup();return result;}
    struct Channel {const char* name;float* ptr;};
    Channel channels[]={{"truck.speed",&speed},{"truck.navigation.speed.limit",&limit},{"truck.fuel.amount",&fuel},{"truck.navigation.distance",&navDistance},{"truck.navigation.time",&navTime},{"local.scale",&scale}};
    for(auto c:channels)p->register_for_channel(c.name,SCS_U32_NIL,SCS_VALUE_TYPE_float,SCS_TELEMETRY_CHANNEL_FLAG_no_value,store_float,c.ptr);
    p->register_for_channel("truck.engine.gear",SCS_U32_NIL,SCS_VALUE_TYPE_s32,SCS_TELEMETRY_CHANNEL_FLAG_none,store_int,&gear);
    register_dashboard(p);
    p->common.log(SCS_LOG_TYPE_message,"Fura GPS 0.11: ETS2/ATS telemetry ready");
    return SCS_RESULT_ok;
}
SCSAPI_VOID scs_telemetry_shutdown(){positionValid=false;paused=true;publish(true);if(sock!=INVALID_SOCKET){closesocket(sock);sock=INVALID_SOCKET;WSACleanup();}}
