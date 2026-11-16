#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cassert>
#include <map>
#include <string>
#include <cstdio>
#include "scssdk_telemetry.h"
struct Channel{scs_telemetry_channel_callback_t callback;scs_context_t context;};
std::map<std::string,Channel> channels;
std::map<scs_event_t,scs_telemetry_event_callback_t> events;
SCSAPI_RESULT register_channel(const scs_string_t name,const scs_u32_t,const scs_value_type_t,const scs_u32_t,const scs_telemetry_channel_callback_t callback,const scs_context_t context){channels[name]={callback,context};return SCS_RESULT_ok;}
SCSAPI_RESULT register_event(const scs_event_t event,const scs_telemetry_event_callback_t callback,const scs_context_t){events[event]=callback;return SCS_RESULT_ok;}
SCSAPI_VOID log_msg(const scs_log_type_t,const scs_string_t text){puts(text);}
void send(const char* name,scs_value_t value){auto c=channels.at(name);c.callback(name,SCS_U32_NIL,&value,c.context);}
int main(int argc,char** argv){
 auto dll=LoadLibraryA(argc>1?argv[1]:"build\\test\\furagps-telemetry.dll");assert(dll);
 auto init=(scs_result_t(SCSAPIFUNC*)(scs_u32_t,const scs_telemetry_init_params_t*))GetProcAddress(dll,"scs_telemetry_init");assert(init);
 auto shutdown=(void(SCSAPIFUNC*)())GetProcAddress(dll,"scs_telemetry_shutdown");assert(shutdown);
 scs_telemetry_init_params_v100_t p{};p.common.game_id=argc>2?argv[2]:"eut2";p.common.log=log_msg;p.register_for_channel=register_channel;p.register_for_event=register_event;
 assert(init(0,&p)==SCS_RESULT_unsupported);assert(init(SCS_TELEMETRY_VERSION_1_01,&p)==SCS_RESULT_ok);
 assert(channels.count("truck.world.placement"));assert(channels.size()==18);assert(events.size()==5);
 scs_value_t value{};value.type=SCS_VALUE_TYPE_dplacement;value.value_dplacement.position.x=1234.5;value.value_dplacement.position.z=-678.25;value.value_dplacement.orientation.heading=.25f;send("truck.world.placement",value);
 value.type=SCS_VALUE_TYPE_float;value.value_float.value=20.0f;send("truck.speed",value);value.value_float.value=25.0f;send("truck.navigation.speed.limit",value);
 value.type=SCS_VALUE_TYPE_s32;value.value_s32.value=10;send("truck.engine.gear",value);
 scs_named_value_t attributes[3]{};attributes[0].name="destination.city.id";attributes[0].value.type=SCS_VALUE_TYPE_string;attributes[0].value.value_string.value="koper";attributes[1].name="destination.company";attributes[1].value.type=SCS_VALUE_TYPE_string;attributes[1].value.value_string.value="Test \"Company\"";
 scs_telemetry_configuration_t config{};config.id="job";config.attributes=attributes;events.at(SCS_TELEMETRY_EVENT_configuration)(SCS_TELEMETRY_EVENT_configuration,&config,nullptr);
 value.type=SCS_VALUE_TYPE_float;value.value_float.value=1500;send("truck.engine.rpm",value);value.value_float.value=900;send("truck.fuel.range",value);value.value_float.value=.3f;send("truck.fuel.consumption.average",value);value.value_float.value=80.0f/3.6f;send("truck.cruise_control",value);value.value_float.value=.91f;send("bus_job.average_satisfaction",value);
 value.type=SCS_VALUE_TYPE_u32;value.value_u32.value=123456;send("game.time",value);value.value_u32.value=2;send("truck.brake.retarder",value);
 value.type=SCS_VALUE_TYPE_s32;value.value_s32.value=15;send("multiplayer.time.offset",value);
 value.type=SCS_VALUE_TYPE_bool;value.value_bool.value=1;send("truck.brake.parking",value);
 value.type=SCS_VALUE_TYPE_fvector;value.value_fvector.x=1.96133f;value.value_fvector.y=9.80665f;value.value_fvector.z=-.980665f;send("truck.local.acceleration.linear",value);
 value.type=SCS_VALUE_TYPE_float;value.value_float.value=1200;send("truck.navigation.time",value);value.value_float.value=19000;send("truck.navigation.distance",value);
 scs_named_value_t bus[7]{};for(int i=0;i<6;i++)bus[i].index=SCS_U32_NIL;
 bus[0].name="destination_stop.arrival_time.planned";bus[0].value.type=SCS_VALUE_TYPE_u32;bus[0].value.value_u32.value=123500;
 bus[1].name="destination_stop.id";bus[1].value.type=SCS_VALUE_TYPE_string;bus[1].value.value_string.value="koper.bus";
 bus[2].name="destination_stop.name";bus[2].value.type=SCS_VALUE_TYPE_string;bus[2].value.value_string.value="Postaja Koper";
 bus[3].name="bus.stages.count";bus[3].value.type=SCS_VALUE_TYPE_u32;bus[3].value.value_u32.value=3;
 bus[4].name="bus.stages.current";bus[4].value.type=SCS_VALUE_TYPE_u32;bus[4].value.value_u32.value=1;
 bus[5].name="destination_stop.arrival_time.actual";bus[5].value.type=SCS_VALUE_TYPE_u32;bus[5].value.value_u32.value=0;
 config.id="bus_job";config.attributes=bus;events.at(SCS_TELEMETRY_EVENT_configuration)(SCS_TELEMETRY_EVENT_configuration,&config,nullptr);
 events.at(SCS_TELEMETRY_EVENT_started)(SCS_TELEMETRY_EVENT_started,nullptr,nullptr);
 // A short force peak between the 10 Hz packets must survive frame aggregation.
 value.type=SCS_VALUE_TYPE_fvector;value.value_fvector.x=7;value.value_fvector.y=.5f;value.value_fvector.z=0;send("truck.local.acceleration.linear",value);
 events.at(SCS_TELEMETRY_EVENT_frame_end)(SCS_TELEMETRY_EVENT_frame_end,nullptr,nullptr);
 Sleep(15);value.value_fvector.x=0;send("truck.local.acceleration.linear",value);
 events.at(SCS_TELEMETRY_EVENT_frame_end)(SCS_TELEMETRY_EVENT_frame_end,nullptr,nullptr);
 Sleep(300);events.at(SCS_TELEMETRY_EVENT_frame_end)(SCS_TELEMETRY_EVENT_frame_end,nullptr,nullptr);
 scs_named_value_t empty[1]{};config.attributes=empty;events.at(SCS_TELEMETRY_EVENT_configuration)(SCS_TELEMETRY_EVENT_configuration,&config,nullptr);
 channels.at("truck.local.acceleration.linear").callback("truck.local.acceleration.linear",SCS_U32_NIL,nullptr,nullptr);
 auto sat=channels.at("bus_job.average_satisfaction");sat.callback("bus_job.average_satisfaction",SCS_U32_NIL,nullptr,sat.context);
 Sleep(300);events.at(SCS_TELEMETRY_EVENT_frame_end)(SCS_TELEMETRY_EVENT_frame_end,nullptr,nullptr);
 std::string longText="A";for(int i=0;i<100;i++)longText+="\xF0\x9F\x9A\x8C";
 scs_named_value_t many[65]{};for(int i=0;i<64;i++){many[i].name="diagnostic.note";many[i].index=i;many[i].value.type=SCS_VALUE_TYPE_string;many[i].value.value_string.value=longText.c_str();}
 config.attributes=many;events.at(SCS_TELEMETRY_EVENT_configuration)(SCS_TELEMETRY_EVENT_configuration,&config,nullptr);
 Sleep(300);events.at(SCS_TELEMETRY_EVENT_frame_end)(SCS_TELEMETRY_EVENT_frame_end,nullptr,nullptr);
 config.attributes=bus;events.at(SCS_TELEMETRY_EVENT_configuration)(SCS_TELEMETRY_EVENT_configuration,&config,nullptr);
 Sleep(500);shutdown();FreeLibrary(dll);puts("PASS: SDK handshake, callback registration, configuration and frame emission");
}
